import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Without a configured secret every
 * request is refused. The comparison takes the same time whatever the header holds.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
