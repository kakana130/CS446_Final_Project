import { beforeAll, describe, expect, it } from 'vitest';

let session: typeof import('./session');

beforeAll(async () => {
  process.env.ADMIN_SESSION_SECRET = 'x'.repeat(64);
  // argon2id hash of "correct horse battery" (m=19456, t=2, p=1).
  const { hash } = await import('@node-rs/argon2');
  process.env.ADMIN_PASSWORD_HASH = await hash('correct horse battery', {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  session = await import('./session');
});

describe('admin password', () => {
  it('accepts only the right password', async () => {
    expect(session.adminConfigured()).toBe(true);
    expect(await session.checkAdminPassword('correct horse battery')).toBe(true);
    expect(await session.checkAdminPassword('wrong')).toBe(false);
    expect(await session.checkAdminPassword('')).toBe(false);
    expect(await session.checkAdminPassword('a'.repeat(201))).toBe(false);
  });
});

describe('session tokens', () => {
  it('verifies a fresh token and rejects expired, tampered or malformed ones', () => {
    const now = Date.now();
    const token = session.createSessionToken(now);
    expect(session.verifySessionToken(token, now + 1000)).toBe(true);
    expect(session.verifySessionToken(token, now + (session.SESSION_SECONDS + 1) * 1000)).toBe(
      false,
    );
    const [exp, nonce, sig] = token.split('.');
    expect(session.verifySessionToken(`${Number(exp) + 999999}.${nonce}.${sig}`, now)).toBe(false);
    expect(session.verifySessionToken(`${exp}.${nonce}.${sig}x`, now)).toBe(false);
    expect(session.verifySessionToken('garbage', now)).toBe(false);
    expect(session.verifySessionToken(null, now)).toBe(false);
  });

  it('reads the cookie from a request and builds strict cookies', () => {
    const req = new Request('http://localhost/api/admin/action', {
      headers: { cookie: `a=1; ${session.ADMIN_COOKIE}=abc.def.ghi; b=2` },
    });
    expect(session.sessionFromRequest(req)).toBe('abc.def.ghi');
    const cookie = session.sessionCookie('t', true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(session.clearedSessionCookie(false)).toContain('Max-Age=0');
  });
});

describe('isSecureRequest', () => {
  it('is secure behind https, a https proxy or a https origin, not on plain local http', () => {
    const req = (url: string, proto?: string) =>
      new Request(url, { headers: proto ? { 'x-forwarded-proto': proto } : {} });
    expect(session.isSecureRequest(req('https://plate2home.example/api'))).toBe(true);
    expect(session.isSecureRequest(req('http://internal/api', 'https'))).toBe(true);
    expect(session.isSecureRequest(req('http://internal/api'), 'https://plate2home.example')).toBe(
      true,
    );
    expect(session.isSecureRequest(req('http://localhost:3000/api'))).toBe(false);
  });
});
