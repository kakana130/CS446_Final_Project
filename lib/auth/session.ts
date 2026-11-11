import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { cookies, headers } from 'next/headers';
import { ensureAccount } from '@/lib/db/accounts';
import { serverEnv, type ServerEnv } from '@/lib/env/server';

/**
 * Optional sign-in (D-085) through Amazon Cognito. It needs an https site (Cognito only redirects
 * to https callback URLs), so the plain-http EC2 deployment leaves it unconfigured and the UI
 * hides it (NEXT_PUBLIC_FEATURE_ACCOUNTS). When enabled: the OAuth 2.0 authorization-code flow with
 * PKCE against the user pool's domain, with Google as the identity provider (or Cognito's own
 * email accounts when COGNITO_IDENTITY_PROVIDER=COGNITO). The ID token is verified against the
 * pool's public keys, then the session lives in our own signed, httpOnly cookie. Data access
 * still goes through lib/db with the user id (the Cognito `sub`).
 */

export interface SessionUser {
  id: string;
  email: string | null;
  /** The Google profile picture, shown only to the user themselves (D-102). */
  avatarUrl: string | null;
}

export const SESSION_COOKIE = 'p2h_session';
const FLOW_COOKIE = 'p2h_oauth';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
const GOOGLE_AVATAR_HOST = 'lh3.googleusercontent.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The profile picture Google sent at sign-in, if it really is a Google one (the CSP allows
 * only this host for images too).
 */
export function googleAvatar(meta: Record<string, unknown> | undefined): string | null {
  const raw = meta?.avatar_url ?? meta?.picture;
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === GOOGLE_AVATAR_HOST ? url.href : null;
  } catch {
    return null;
  }
}

export function authConfigured(): boolean {
  const env = serverEnv();
  return Boolean(
    env.COGNITO_USER_POOL_ID &&
    env.COGNITO_DOMAIN &&
    env.COGNITO_CLIENT_ID &&
    env.AUTH_SESSION_SECRET,
  );
}

/**
 * Only accounts from the configured identity provider count (D-085). With Google, the ID
 * token's `identities` claim (set by Cognito, not the user) must name Google.
 */
export function isAllowedIdentity(claims: JWTPayload, provider: string): boolean {
  const identities = Array.isArray(claims.identities)
    ? (claims.identities as { providerName?: unknown }[])
    : [];
  if (provider === 'COGNITO') return identities.length === 0;
  return identities.some((i) => i.providerName === provider);
}

/**
 * Where to go after signing in: a path on this site only (no `//host` or `/\host` tricks).
 * Defaults to the page that tells the opener and closes itself.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/signed-in';
  }
  return next;
}

/* ------------------------------------------------------------------ signed cookie values */

const sign = (key: string, payload: string) =>
  createHmac('sha256', key).update(payload).digest('base64url');

export function sealValue(key: string, value: object): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(key, payload)}`;
}

export function openValue<T extends { exp: number }>(
  key: string,
  token: string | undefined,
  now = Date.now(),
): T | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(key, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
    return typeof value.exp === 'number' && value.exp * 1000 > now ? value : null;
  } catch {
    return null;
  }
}

async function isSecure(env: ServerEnv): Promise<boolean> {
  // Behind a TLS-terminating proxy the app sees plain http; APP_ORIGIN says the site is https.
  return (
    (await headers()).get('x-forwarded-proto') === 'https' ||
    (env.APP_ORIGIN ?? '').startsWith('https://')
  );
}

async function setCookie(name: string, value: string, maxAge: number) {
  const env = serverEnv();
  (await cookies()).set(name, value, {
    httpOnly: true,
    secure: await isSecure(env),
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

/* ----------------------------------------------------------------------------- Cognito */

const nowSeconds = () => Math.floor(Date.now() / 1000);

function cognito() {
  const env = serverEnv();
  const poolId = env.COGNITO_USER_POOL_ID!;
  const region = poolId.split('_')[0]!;
  return {
    env,
    domain: env.COGNITO_DOMAIN!.replace(/\/+$/, ''),
    clientId: env.COGNITO_CLIENT_ID!,
    issuer: `https://cognito-idp.${region}.amazonaws.com/${poolId}`,
    key: env.AUTH_SESSION_SECRET!,
  };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
const keySet = (issuer: string) =>
  (jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));

interface Flow {
  state: string;
  verifier: string;
  next: string;
  exp: number;
}

/** Start sign-in: remember state + PKCE verifier in a short-lived cookie, return Cognito's URL. */
export async function beginSignIn(origin: string, next: string): Promise<string> {
  const c = cognito();
  const flow: Flow = {
    state: randomBytes(24).toString('base64url'),
    verifier: randomBytes(48).toString('base64url'),
    next,
    exp: nowSeconds() + FLOW_SECONDS,
  };
  await setCookie(FLOW_COOKIE, sealValue(c.key, flow), FLOW_SECONDS);

  const url = new URL(`${c.domain}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('redirect_uri', `${origin}/api/auth/callback`);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', flow.state);
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(flow.verifier).digest('base64url'),
  );
  url.searchParams.set('code_challenge_method', 'S256');
  if (c.env.COGNITO_IDENTITY_PROVIDER !== 'COGNITO') {
    url.searchParams.set('identity_provider', c.env.COGNITO_IDENTITY_PROVIDER);
  }
  return url.href;
}

/** The `next` path saved when sign-in started (for redirects on failure too). */
export async function pendingNext(): Promise<string> {
  const flow = openValue<Flow>(cognito().key, (await cookies()).get(FLOW_COOKIE)?.value);
  return safeNext(flow?.next ?? null);
}

/** Cognito sent the user back: check state, swap the code, verify the ID token, set session. */
export async function finishSignIn(origin: string, code: string, state: string): Promise<string> {
  const c = cognito();
  const store = await cookies();
  const flow = openValue<Flow>(c.key, store.get(FLOW_COOKIE)?.value);
  store.delete(FLOW_COOKIE);
  if (!flow || flow.state.length !== state.length) throw new Error('auth_state');
  if (!timingSafeEqual(Buffer.from(flow.state), Buffer.from(state))) throw new Error('auth_state');

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: c.clientId,
    code,
    redirect_uri: `${origin}/api/auth/callback`,
    code_verifier: flow.verifier,
  });
  const tokenHeaders: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (c.env.COGNITO_CLIENT_SECRET) {
    // A confidential app client: client_secret_basic.
    const basic = Buffer.from(`${c.clientId}:${c.env.COGNITO_CLIENT_SECRET}`).toString('base64');
    tokenHeaders.authorization = `Basic ${basic}`;
  }
  const res = await fetch(`${c.domain}/oauth2/token`, {
    method: 'POST',
    headers: tokenHeaders,
    body: form,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`auth_token_${res.status}`);
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error('auth_no_id_token');

  const { payload } = await jwtVerify(idToken, keySet(c.issuer), {
    issuer: c.issuer,
    audience: c.clientId,
  });
  if (payload.token_use !== 'id' || typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
    throw new Error('auth_bad_token');
  }
  if (!isAllowedIdentity(payload, c.env.COGNITO_IDENTITY_PROVIDER)) {
    throw new Error('auth_provider');
  }

  await ensureAccount(payload.sub);
  const email =
    typeof payload.email === 'string' && payload.email_verified !== false ? payload.email : null;
  await setCookie(
    SESSION_COOKIE,
    sealValue(c.key, {
      sub: payload.sub,
      email,
      pic: googleAvatar(payload as Record<string, unknown>),
      exp: nowSeconds() + SESSION_SECONDS,
    }),
    SESSION_SECONDS,
  );
  return safeNext(flow.next);
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user, from our signed session cookie. */
export async function currentUser(): Promise<SessionUser | null> {
  if (!authConfigured()) return null;
  const value = openValue<{ sub: string; email: string | null; pic: string | null; exp: number }>(
    cognito().key,
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (!value || !UUID.test(value.sub)) return null;
  return { id: value.sub, email: value.email, avatarUrl: googleAvatar({ picture: value.pic }) };
}
