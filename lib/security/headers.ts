/**
 * Static security headers applied to every response via next.config.ts.
 * The per-request CSP for pages is added by proxy.ts; API routes get a locked-down CSP here.
 */

export interface Header {
  key: string;
  value: string;
}

export const securityHeaders: Header[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Camera for the found flow only on our own origin; nothing else.
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  // Legacy clickjacking protection for browsers without frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

export const apiHeaders: Header[] = [
  { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
  { key: 'Cache-Control', value: 'no-store' },
];
