import 'server-only';
import { createHmac } from 'node:crypto';
import { requireEnv } from '@/lib/env/server';

/**
 * Client IP behind Amazon CloudFront. CloudFront sets `CloudFront-Viewer-Address`
 * (`<ip>:<port>`) itself, so a viewer can't spoof it; the EC2 security group only admits
 * CloudFront, so the header is always CloudFront's. Without it (local dev, or a direct hit in
 * development) fall back to `x-real-ip` / the first `x-forwarded-for` entry. Only ever used
 * hashed.
 */
export function clientIp(headers: Headers): string {
  const viewer = headers.get('cloudfront-viewer-address')?.trim();
  if (viewer) {
    const cut = viewer.lastIndexOf(':');
    const ip = cut > 0 ? viewer.slice(0, cut) : viewer;
    if (ip) return ip;
  }
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || '0.0.0.0';
}

export type IpHashScope = 'daily' | 'reports';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Day (Asia/Bangkok) or 60-day bucket the salt belongs to. */
function period(scope: IpHashScope, now: Date): string {
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  if (scope === 'daily') return `d:${bangkok.toISOString().slice(0, 10)}`;
  return `r:${Math.floor(bangkok.getTime() / (60 * DAY_MS))}`;
}

/**
 * HMAC-SHA256 of the IP under a salt derived from IP_HASH_SECRET and the current period, so
 * salts rotate automatically and are never stored.
 * - daily:   rate limits, reveal logs (can't be linked across days)
 * - reports: report de-duplication over a post's lifetime (D-024)
 */
export function hashIp(ip: string, scope: IpHashScope = 'daily', now = new Date()): string {
  const salt = createHmac('sha256', requireEnv('IP_HASH_SECRET'))
    .update(period(scope, now))
    .digest();
  return createHmac('sha256', salt).update(ip).digest('hex');
}
