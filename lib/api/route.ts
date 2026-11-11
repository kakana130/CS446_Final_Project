import 'server-only';
import { z } from 'zod';
import { MAX_JSON_BYTES } from '@/lib/config/app';
import type { RateLimitBucket } from '@/lib/config/rate-limits';
import { getSiteSettings } from '@/lib/db/site';
import { hitRateLimit } from '@/lib/db/ratelimit';
import { serverEnv } from '@/lib/env/server';
import { logError } from '@/lib/log';
import { clientIp, hashIp } from '@/lib/security/ip';
import { isSameOrigin } from '@/lib/security/origin';
import { fieldErrors } from '@/lib/validation/schemas';

/** An expected failure with a stable code the client maps to a message. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface ApiContext<P> {
  ip: string;
  /** Daily-salted HMAC of the IP; the raw IP is never stored. */
  ipHash: string;
  params: P;
}

/**
 * Wraps every API route: same-origin check for writes, uniform `{ code }` errors, zod issues
 * as `{ code: 'invalid_input', fields }`, no request data in logs, `no-store` responses.
 */
export function apiRoute<P = Record<string, never>>(
  scope: string,
  handler: (request: Request, ctx: ApiContext<P>) => Promise<Response>,
) {
  return async (request: Request, route: { params: Promise<P> }): Promise<Response> => {
    try {
      if (request.method !== 'GET' && !isSameOrigin(request, serverEnv().APP_ORIGIN)) {
        throw new ApiError('bad_origin', 403);
      }
      const ip = clientIp(request.headers);
      return await handler(request, { ip, ipHash: hashIp(ip), params: await route.params });
    } catch (err) {
      if (err instanceof ApiError) {
        const headers: HeadersInit =
          err.status === 429 ? { 'retry-after': String(err.extra.retryAfter ?? 60) } : {};
        return Response.json({ code: err.code, ...err.extra }, { status: err.status, headers });
      }
      if (err instanceof z.ZodError) {
        return Response.json({ code: 'invalid_input', fields: fieldErrors(err) }, { status: 400 });
      }
      logError(scope, err);
      return Response.json({ code: 'internal' }, { status: 500 });
    }
  };
}

export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new ApiError('too_large', 413);
  const text = await request.text();
  if (text.length > maxBytes) throw new ApiError('too_large', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('bad_json', 400);
  }
}

export async function enforceRateLimit(bucket: RateLimitBucket, subject: string): Promise<void> {
  const { allowed, retryAfterSeconds } = await hitRateLimit(bucket, subject);
  if (!allowed) throw new ApiError('rate_limited', 429, { retryAfter: retryAfterSeconds });
}

/** Dormant mode: posting and search are closed; data retention jobs keep running. */
export async function assertSiteActive(): Promise<void> {
  const { mode } = await getSiteSettings();
  if (mode === 'dormant') throw new ApiError('dormant', 503);
}
