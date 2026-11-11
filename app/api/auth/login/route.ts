import { NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/api/route';
import { authConfigured, beginSignIn, safeNext } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env/server';
import { logError } from '@/lib/log';
import { clientIp, hashIp } from '@/lib/security/ip';

/**
 * Start sign-in with Amazon Cognito (D-085). Opened in a pop-up so the page underneath keeps
 * its photos and form; PKCE keeps the code verifier in an httpOnly cookie until the callback.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = serverEnv().APP_ORIGIN ?? url.origin;
  const next = safeNext(url.searchParams.get('next'));
  const failed = () => NextResponse.redirect(`${origin}${next}?error=1`, 303);
  if (!authConfigured()) return failed();
  try {
    await enforceRateLimit('auth:login', hashIp(clientIp(request.headers)));
    return NextResponse.redirect(await beginSignIn(origin, next), 303);
  } catch (err) {
    logError('api/auth/login', err);
    return failed();
  }
}
