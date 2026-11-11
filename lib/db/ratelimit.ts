import 'server-only';
import { RATE_LIMITS, type RateLimitBucket } from '@/lib/config/rate-limits';
import { toDbError } from './errors';
import { rpc } from './server';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Count one hit for `subject` (an IP hash or batch id) in `bucket`'s current window. */
export async function hitRateLimit(
  bucket: RateLimitBucket,
  subject: string,
): Promise<RateLimitResult> {
  const { windowSeconds, max } = RATE_LIMITS[bucket];
  const { data, error } = await rpc('rl_hit', {
    p_bucket: bucket,
    p_subject: subject,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
  if (error) throw toDbError('rl_hit', error);
  const row = (data as { allowed: boolean; reset_at: string }[])[0];
  if (!row) throw toDbError('rl_hit', { code: 'no_row' });
  return {
    allowed: row.allowed,
    retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(row.reset_at) - Date.now()) / 1000)),
  };
}
