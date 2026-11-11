import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env/server';
import { verifySecret as verifyArgon2 } from '@/lib/security/argon2';

/**
 * Admin session (D-080): one password, checked against an argon2id hash from the
 * environment; success sets a signed, httpOnly, SameSite=Strict cookie for 12 hours.
 * Without ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET the admin area stays closed.
 */

export const ADMIN_COOKIE = 'p2h_admin';
export const SESSION_SECONDS = 12 * 60 * 60;

function secret(): string | null {
  return serverEnv().ADMIN_SESSION_SECRET ?? null;
}

export function adminConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.ADMIN_PASSWORD_HASH && env.ADMIN_SESSION_SECRET);
}

export async function checkAdminPassword(password: string): Promise<boolean> {
  const hash = serverEnv().ADMIN_PASSWORD_HASH;
  if (!hash || password.length === 0 || password.length > 200) return false;
  return verifyArgon2(hash, password);
}

const sign = (key: string, payload: string) =>
  createHmac('sha256', key).update(payload).digest('base64url');

/** `<expires>.<nonce>.<signature>` */
export function createSessionToken(now = Date.now()): string {
  const key = secret();
  if (!key) throw new Error('admin_not_configured');
  const payload = `${Math.floor(now / 1000) + SESSION_SECONDS}.${randomBytes(16).toString('base64url')}`;
  return `${payload}.${sign(key, payload)}`;
}

export function verifySessionToken(token: string | undefined | null, now = Date.now()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts as [string, string, string];
  const expected = sign(key, `${exp}.${nonce}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(exp) * 1000 > now;
}

/** The session cookie value from a request's Cookie header. */
export function sessionFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ADMIN_COOKIE) return rest.join('=');
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${ADMIN_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_SECONDS}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Mark the cookie Secure whenever the site is served over https: the request itself, the
 * proxy in front of it (Vercel), or the configured origin. Plain http only in local dev.
 */
export function isSecureRequest(request: Request, appOrigin?: string): boolean {
  return (
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https' ||
    (appOrigin ?? '').startsWith('https://')
  );
}

export function clearedSessionCookie(secure: boolean): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
