import 'server-only';
import { serverEnv } from '@/lib/env/server';
import type { TurnstileAction } from './turnstile-actions';

export type { TurnstileAction };

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  success: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
}

/** Cloudflare's documented test secrets accept only the dummy token and report example.com. */
const isTestSecret = (secret: string) => /^[123]x0{31}AA$/.test(secret);

/**
 * Server-side Turnstile verification. Returns false on any failure, including network errors
 * (fail closed). With production keys the hostname and action must match too.
 */
export async function verifyTurnstile(
  token: unknown,
  action: TurnstileAction,
  remoteIp: string,
): Promise<boolean> {
  const env = serverEnv();
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret || typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return false;
  }

  let data: SiteverifyResponse;
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    data = (await res.json()) as SiteverifyResponse;
  } catch {
    return false;
  }

  if (!data.success) return false;
  if (isTestSecret(secret)) return true;

  if (data.action !== action) return false;
  if (env.APP_ORIGIN && data.hostname !== new URL(env.APP_ORIGIN).hostname) return false;
  return true;
}
