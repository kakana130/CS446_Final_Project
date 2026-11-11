import { describe, expect, it } from 'vitest';
import { isCronAuthorized } from './cron';

const SECRET = 's'.repeat(32);

describe('isCronAuthorized', () => {
  it('accepts the bearer token Vercel Cron sends', () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('refuses a missing or wrong header', () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized('', SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    expect(isCronAuthorized('Bearer ', undefined)).toBe(false);
    expect(isCronAuthorized('Bearer undefined', undefined)).toBe(false);
  });
});
