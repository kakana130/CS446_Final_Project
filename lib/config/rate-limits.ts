/**
 * Fixed-window rate limits per IP hash (Postgres `rl_hit`). Mobile carriers put many people
 * behind one IP, so these are generous; Turnstile is the primary bot control.
 */
export const RATE_LIMITS = {
  'lost:create': { windowSeconds: 60 * 60, max: 10 },
  'found:batch': { windowSeconds: 60 * 60, max: 10 },
  'found:plate': { windowSeconds: 60 * 60, max: 80 },
  search: { windowSeconds: 10 * 60, max: 60 },
  // Checked per plate as the finder types (debounced); answers only yes/no, see D-064.
  'lost-check': { windowSeconds: 10 * 60, max: 120 },
  // Contact reveals: per IP, and per post (a scraper rotating IPs still hits the post cap).
  reveal: { windowSeconds: 60 * 60, max: 20 },
  'reveal:post': { windowSeconds: 24 * 60 * 60, max: 60 },
  'reveal:owner': { windowSeconds: 60 * 60, max: 30 },
  'my-posts': { windowSeconds: 10 * 60, max: 60 },
  // Managing a post with a device token or a signed-in account (D-085).
  manage: { windowSeconds: 10 * 60, max: 30 },
  // Starting Google sign-in (each start leaves a PKCE flow in Supabase Auth).
  'auth:login': { windowSeconds: 10 * 60, max: 30 },
  report: { windowSeconds: 60 * 60, max: 10 },
  feedback: { windowSeconds: 60 * 60, max: 5 },
  // Admin password: per IP, and for everyone together (a distributed guess still stops).
  'admin:login': { windowSeconds: 15 * 60, max: 5 },
  'admin:login-all': { windowSeconds: 60 * 60, max: 30 },
} as const satisfies Record<string, { windowSeconds: number; max: number }>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;
