import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerEnvForTests } from '@/lib/env/server';
import { clientIp, hashIp } from './ip';
import { isSameOrigin } from './origin';
import { hashSecret, verifySecret } from './argon2';
import { randomToken, sha256Hex, TOKEN_PATTERN } from './tokens';
import { verifyTurnstile } from './turnstile';

const saved = { ...process.env };
beforeEach(() => {
  process.env.IP_HASH_SECRET = 'test-secret-test-secret-test-secret';
  resetServerEnvForTests();
});
afterEach(() => {
  process.env = { ...saved };
  resetServerEnvForTests();
  vi.unstubAllGlobals();
});

describe('tokens', () => {
  it('are 256-bit, URL-safe and unique', () => {
    const a = randomToken();
    expect(a).toMatch(TOKEN_PATTERN);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(randomToken()).not.toBe(a);
  });

  it('hash to 64 hex chars', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('argon2id hashing', () => {
  it('uses argon2id and verifies only the right PIN', async () => {
    const h = await hashSecret('2580');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(h).toContain('m=19456,t=2,p=1');
    expect(await verifySecret(h, '2580')).toBe(true);
    expect(await verifySecret(h, '2581')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashSecret('2580')).not.toBe(await hashSecret('2580'));
  });

  it('treats a malformed hash as a mismatch', async () => {
    expect(await verifySecret('not-a-hash', '2580')).toBe(false);
  });
});

describe('IP handling', () => {
  it('prefers x-real-ip, then the first x-forwarded-for entry', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe(
      '1.1.1.1',
    );
    expect(clientIp(new Headers({ 'x-forwarded-for': '3.3.3.3, 10.0.0.1' }))).toBe('3.3.3.3');
    expect(clientIp(new Headers())).toBe('0.0.0.0');
  });

  it('hashes deterministically within a day and differently across days', () => {
    const day1 = new Date('2026-09-28T03:00:00Z');
    const day1Later = new Date('2026-09-28T15:00:00Z');
    const day2 = new Date('2026-09-29T03:00:00Z');
    expect(hashIp('1.2.3.4', 'daily', day1)).toBe(hashIp('1.2.3.4', 'daily', day1Later));
    expect(hashIp('1.2.3.4', 'daily', day1)).not.toBe(hashIp('1.2.3.4', 'daily', day2));
    expect(hashIp('1.2.3.4', 'daily', day1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the Bangkok calendar day (UTC+7)', () => {
    // 18:00 UTC is already the next day in Bangkok.
    const lateUtc = new Date('2026-09-28T18:00:00Z');
    const nextMorning = new Date('2026-09-29T02:00:00Z');
    expect(hashIp('1.2.3.4', 'daily', lateUtc)).toBe(hashIp('1.2.3.4', 'daily', nextMorning));
  });

  it('keeps the reports salt stable for weeks', () => {
    const a = new Date('2026-09-28T00:00:00Z');
    const b = new Date('2026-10-05T00:00:00Z');
    expect(hashIp('1.2.3.4', 'reports', a)).toBe(hashIp('1.2.3.4', 'reports', b));
    expect(hashIp('1.2.3.4', 'reports', a)).not.toBe(hashIp('1.2.3.4', 'daily', a));
  });

  it('depends on the secret', () => {
    const d = new Date('2026-09-28T00:00:00Z');
    const first = hashIp('1.2.3.4', 'daily', d);
    process.env.IP_HASH_SECRET = 'another-secret-another-secret-xx';
    resetServerEnvForTests();
    expect(hashIp('1.2.3.4', 'daily', d)).not.toBe(first);
  });
});

describe('isSameOrigin', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://plate2home.example/api/lost', { method: 'POST', headers });

  it('accepts our own Origin', () => {
    expect(isSameOrigin(req({ origin: 'https://plate2home.example' }))).toBe(true);
  });

  it('rejects another Origin', () => {
    expect(isSameOrigin(req({ origin: 'https://evil.example' }))).toBe(false);
  });

  it('uses APP_ORIGIN when configured (proxies may rewrite the request URL)', () => {
    expect(isSameOrigin(req({ origin: 'https://app.example' }), 'https://app.example')).toBe(true);
  });

  it('falls back to Sec-Fetch-Site, and rejects requests with neither header', () => {
    expect(isSameOrigin(req({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(false);
  });
});

describe('verifyTurnstile', () => {
  const respond = (body: object, ok = true) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }));

  it('fails closed without a secret or token', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    resetServerEnvForTests();
    expect(await verifyTurnstile('tok', 'lost_create', '1.1.1.1')).toBe(false);
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    resetServerEnvForTests();
    expect(await verifyTurnstile('', 'lost_create', '1.1.1.1')).toBe(false);
    expect(await verifyTurnstile(undefined, 'lost_create', '1.1.1.1')).toBe(false);
  });

  it('accepts a successful response with Cloudflare test keys (no hostname/action check)', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    resetServerEnvForTests();
    const fetchMock = respond({ success: true, hostname: 'example.com' });
    vi.stubGlobal('fetch', fetchMock);
    expect(await verifyTurnstile('XXXX.DUMMY.TOKEN.XXXX', 'lost_create', '1.1.1.1')).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      response: 'XXXX.DUMMY.TOKEN.XXXX',
      remoteip: '1.1.1.1',
    });
  });

  it('with production keys, requires matching action and hostname', async () => {
    process.env.TURNSTILE_SECRET_KEY = '0x4AAAAAAAreal-secret';
    process.env.APP_ORIGIN = 'https://plate2home.example';
    resetServerEnvForTests();
    vi.stubGlobal(
      'fetch',
      respond({ success: true, hostname: 'plate2home.example', action: 'lost_create' }),
    );
    expect(await verifyTurnstile('t', 'lost_create', '1.1.1.1')).toBe(true);
    vi.stubGlobal(
      'fetch',
      respond({ success: true, hostname: 'plate2home.example', action: 'reveal' }),
    );
    expect(await verifyTurnstile('t', 'lost_create', '1.1.1.1')).toBe(false);
    vi.stubGlobal(
      'fetch',
      respond({ success: true, hostname: 'evil.example', action: 'lost_create' }),
    );
    expect(await verifyTurnstile('t', 'lost_create', '1.1.1.1')).toBe(false);
  });

  it('fails closed on unsuccessful, erroring or unreachable verification', async () => {
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    resetServerEnvForTests();
    vi.stubGlobal('fetch', respond({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verifyTurnstile('t', 'lost_create', '1.1.1.1')).toBe(false);
    vi.stubGlobal('fetch', respond({}, false));
    expect(await verifyTurnstile('t', 'lost_create', '1.1.1.1')).toBe(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('network'))),
    );
    expect(await verifyTurnstile('t', 'lost_create', '1.1.1.1')).toBe(false);
  });
});
