import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireEnv, resetServerEnvForTests, serverEnv } from './server';

const saved = { ...process.env };

beforeEach(() => {
  resetServerEnvForTests();
});

afterEach(() => {
  process.env = { ...saved };
  resetServerEnvForTests();
});

describe('serverEnv', () => {
  it('parses boolean flags strictly', () => {
    process.env.ACCESS_LOG_ENABLED = 'true';
    process.env.NEXT_PUBLIC_FEATURE_OCR = 'false';
    expect(serverEnv().ACCESS_LOG_ENABLED).toBe(true);
    expect(serverEnv().NEXT_PUBLIC_FEATURE_OCR).toBe(false);
  });

  it('keeps the access log off unless explicitly enabled', () => {
    delete process.env.ACCESS_LOG_ENABLED;
    expect(serverEnv().ACCESS_LOG_ENABLED).toBe(false);
  });

  it('keeps the cron on unless explicitly disabled', () => {
    delete process.env.CRON_ENABLED;
    expect(serverEnv().CRON_ENABLED).toBe(true);
    resetServerEnvForTests();
    process.env.CRON_ENABLED = 'false';
    expect(serverEnv().CRON_ENABLED).toBe(false);
  });

  it('reports invalid variable names without leaking values', () => {
    process.env.IP_HASH_SECRET = 'short-secret-val';
    process.env.ACCESS_LOG_KEY = 'not-a-key';
    expect(() => serverEnv()).toThrow(/ACCESS_LOG_KEY/);
    expect(() => serverEnv()).not.toThrow(/not-a-key/);
  });

  it('accepts an admin hash that kept its .env escapes', () => {
    process.env.ADMIN_PASSWORD_HASH = '\\$argon2id\\$v=19\\$m=19456,t=2,p=1\\$c2FsdA\\$aGFzaA';
    expect(serverEnv().ADMIN_PASSWORD_HASH).toBe('$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA');
  });

  it('closes only the admin area when its settings are wrong', () => {
    process.env.ADMIN_PASSWORD_HASH = 'not-a-hash';
    process.env.ADMIN_SESSION_SECRET = 'short';
    process.env.CRON_SECRET = 'c'.repeat(32);
    const env = serverEnv();
    expect(env.ADMIN_PASSWORD_HASH).toBeUndefined();
    expect(env.ADMIN_SESSION_SECRET).toBeUndefined();
    expect(env.CRON_SECRET).toBe('c'.repeat(32));
  });

  it('still fails when anything else is wrong too', () => {
    process.env.ADMIN_PASSWORD_HASH = 'not-a-hash';
    process.env.ACCESS_LOG_KEY = 'not-a-key';
    expect(() => serverEnv()).toThrow(/ACCESS_LOG_KEY/);
  });
});

describe('requireEnv', () => {
  it('throws with the variable name when missing', () => {
    delete process.env.CRON_SECRET;
    expect(() => requireEnv('CRON_SECRET')).toThrow(
      'Missing required environment variable: CRON_SECRET',
    );
  });

  it('returns the value when present', () => {
    process.env.CRON_SECRET = 'a'.repeat(32);
    expect(requireEnv('CRON_SECRET')).toBe('a'.repeat(32));
  });
});
