import { NextResponse } from 'next/server';
import { authConfigured, finishSignIn, pendingNext } from '@/lib/auth/session';
import { serverEnv } from '@/lib/env/server';
import { logError } from '@/lib/log';

/**
 * Cognito sends the user back here (this exact URL is the app client's callback URL): swap
 * the code for a verified ID token and a session cookie, then go on.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = serverEnv().APP_ORIGIN ?? url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!authConfigured()) return NextResponse.redirect(`${origin}/signed-in?error=1`, 303);
  const next = await pendingNext();
  if (!code || !state) return NextResponse.redirect(`${origin}${next}?error=1`, 303);
  try {
    return NextResponse.redirect(`${origin}${await finishSignIn(origin, code, state)}`, 303);
  } catch (err) {
    logError('api/auth/callback', err);
    return NextResponse.redirect(`${origin}${next}?error=1`, 303);
  }
}
