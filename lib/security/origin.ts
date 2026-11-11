/**
 * CSRF defence for state-changing API routes: the request must come from our own origin.
 * Browsers always send `Origin` on cross-origin and on same-origin POSTs; when it is absent,
 * `Sec-Fetch-Site` must say same-origin. Requests with neither are rejected.
 */
export function isSameOrigin(request: Request, appOrigin?: string): boolean {
  const expected = appOrigin ?? new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin !== null) return origin === expected;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}
