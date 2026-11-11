import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { LOCALE_COOKIE, routing } from '@/i18n/routing';
import { buildCsp, createNonce } from '@/lib/security/csp';

const handleI18n = createMiddleware(routing);

const isAdminPath = (pathname: string) => pathname === '/admin' || pathname.startsWith('/admin/');

const hasLocalePrefix = (pathname: string) =>
  routing.locales.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdmin = isAdminPath(pathname);

  // An explicit English choice (set by the language switcher) wins on unprefixed URLs.
  // Accept-Language is deliberately ignored; see i18n/routing.ts.
  if (
    !isAdmin &&
    request.method === 'GET' &&
    request.cookies.get(LOCALE_COOKIE)?.value === 'en' &&
    !hasLocalePrefix(pathname)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/' ? '/en' : `/en${pathname}`;
    return NextResponse.redirect(url);
  }

  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === 'development',
    storageOrigin:
      process.env.S3_BUCKET && process.env.AWS_REGION
        ? `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
        : undefined,
    // Behind a TLS-terminating proxy the request to the app is plain http; APP_ORIGIN says
    // whether visitors use https (the plain-http EC2 + nginx setup does not).
    secure:
      request.nextUrl.protocol === 'https:' ||
      (process.env.APP_ORIGIN ?? '').startsWith('https://'),
  });

  // Next.js reads the nonce from the request's CSP header while rendering. Mutating the
  // incoming headers (rather than cloning the request) leaves any request body untouched.
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', csp);

  // Admin pages and routes check the password session themselves (D-080).
  const response = isAdmin
    ? NextResponse.next({ request: { headers: request.headers } })
    : handleI18n(request);

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Everything except API routes, Next internals and files with an extension.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
