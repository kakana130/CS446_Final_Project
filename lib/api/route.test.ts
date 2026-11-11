import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const site = vi.hoisted(() => ({ mode: 'active' as 'active' | 'dormant' }));
const limit = vi.hoisted(() => ({ allowed: true }));

vi.mock('@/lib/db/site', () => ({
  getSiteSettings: async () => ({ mode: site.mode, bannerTh: null, bannerEn: null }),
}));
vi.mock('@/lib/db/ratelimit', () => ({
  hitRateLimit: async () => ({ allowed: limit.allowed, retryAfterSeconds: 42 }),
}));

const { ApiError, apiRoute, assertSiteActive, enforceRateLimit, readJson } =
  await import('./route');
const { resetServerEnvForTests } = await import('@/lib/env/server');

const saved = { ...process.env };
beforeEach(() => {
  process.env.IP_HASH_SECRET = 'test-secret-test-secret-test-secret';
  delete process.env.APP_ORIGIN;
  resetServerEnvForTests();
  site.mode = 'active';
  limit.allowed = true;
});
afterEach(() => {
  process.env = { ...saved };
  resetServerEnvForTests();
});

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://app.example/api/x', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json', ...headers },
    body,
  });
const noParams = { params: Promise.resolve({}) };

describe('apiRoute', () => {
  it('rejects cross-origin writes before running the handler', async () => {
    const handler = vi.fn();
    const res = await apiRoute('t', handler)(
      post('{}', { origin: 'https://evil.example' }),
      noParams,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'bad_origin' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes a hashed IP (never the raw one) and params to the handler', async () => {
    const route = apiRoute<{ id: string }>('t', async (_req, ctx) =>
      Response.json({ ipHash: ctx.ipHash, id: ctx.params.id }),
    );
    const res = await route(post('{}', { 'x-real-ip': '9.9.9.9' }), {
      params: Promise.resolve({ id: 'b1' }),
    });
    const body = await res.json();
    expect(body.id).toBe('b1');
    expect(body.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain('9.9.9.9');
  });

  it('maps zod errors to 400 with per-field codes', async () => {
    const schema = z.object({ phone: z.string().regex(/^\d{4}$/, 'phone_invalid') });
    const res = await apiRoute('t', async (req) => {
      schema.parse(await readJson(req));
      return Response.json({});
    })(post('{"phone":"12"}'), noParams);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'invalid_input', fields: { phone: 'phone_invalid' } });
  });

  it('maps ApiError to its status and code, with retry-after for 429', async () => {
    const res = await apiRoute('t', async () => {
      throw new ApiError('rate_limited', 429, { retryAfter: 7 });
    })(post('{}'), noParams);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
    expect(await res.json()).toEqual({ code: 'rate_limited', retryAfter: 7 });
  });

  it('hides unexpected errors behind a generic 500 and logs no details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await apiRoute('scope', async () => {
      throw new Error('duplicate key value (plate_canonical)=(car||กข|1234|TH-10)');
    })(post('{}'), noParams);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'internal' });
    expect(spy).toHaveBeenCalledWith('[scope] Error');
    spy.mockRestore();
  });
});

describe('helpers', () => {
  it('readJson rejects oversized and malformed bodies', async () => {
    await expect(readJson(post('x'.repeat(100)), 10)).rejects.toMatchObject({
      code: 'too_large',
      status: 413,
    });
    await expect(readJson(post('{not json'))).rejects.toMatchObject({ code: 'bad_json' });
    await expect(readJson(post('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it('enforceRateLimit throws 429 when the window is exhausted', async () => {
    await expect(enforceRateLimit('search', 'h')).resolves.toBeUndefined();
    limit.allowed = false;
    await expect(enforceRateLimit('search', 'h')).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      extra: { retryAfter: 42 },
    });
  });

  it('assertSiteActive throws 503 in dormant mode', async () => {
    await expect(assertSiteActive()).resolves.toBeUndefined();
    site.mode = 'dormant';
    await expect(assertSiteActive()).rejects.toMatchObject({ code: 'dormant', status: 503 });
  });
});
