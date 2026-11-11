import { describe, expect, it } from 'vitest';
import { googleAvatar, isAllowedIdentity, openValue, safeNext, sealValue } from './session';

describe('isAllowedIdentity (Cognito ID token)', () => {
  const google = { identities: [{ providerName: 'Google', userId: '1' }] };

  it('accepts Google users when Google is the provider', () => {
    expect(isAllowedIdentity(google, 'Google')).toBe(true);
  });

  it('rejects Cognito email accounts or other providers when Google is required', () => {
    expect(isAllowedIdentity({}, 'Google')).toBe(false);
    expect(isAllowedIdentity({ identities: [{ providerName: 'Facebook' }] }, 'Google')).toBe(false);
    expect(isAllowedIdentity({ identities: 'Google' }, 'Google')).toBe(false);
  });

  it('accepts only native accounts in COGNITO mode', () => {
    expect(isAllowedIdentity({}, 'COGNITO')).toBe(true);
    expect(isAllowedIdentity(google, 'COGNITO')).toBe(false);
  });
});

describe('sealed cookie values', () => {
  const key = 'k'.repeat(40);
  const exp = Math.floor(Date.now() / 1000) + 60;

  it('round-trips a signed value', () => {
    expect(openValue(key, sealValue(key, { sub: 'a', exp }))).toEqual({ sub: 'a', exp });
  });

  it('rejects tampering, another key and expiry', () => {
    const token = sealValue(key, { sub: 'a', exp });
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'b', exp })).toString('base64url');
    expect(openValue(key, `${forged}.${sig}`)).toBeNull();
    expect(openValue('x'.repeat(40), token)).toBeNull();
    expect(openValue(key, `${payload}`)).toBeNull();
    expect(openValue(key, token, (exp + 1) * 1000)).toBeNull();
    expect(openValue(key, undefined)).toBeNull();
  });
});

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/en/signed-in')).toBe('/en/signed-in');
    expect(safeNext('/lost')).toBe('/lost');
  });

  it('falls back for anything that could leave the site', () => {
    for (const bad of [null, '', 'https://evil.test', '//evil.test', '/\\evil.test', 'lost']) {
      expect(safeNext(bad)).toBe('/signed-in');
    }
  });
});

describe('googleAvatar (D-102)', () => {
  const pic = 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c';

  it('takes the Google profile picture from avatar_url or picture', () => {
    expect(googleAvatar({ avatar_url: pic })).toBe(pic);
    expect(googleAvatar({ picture: pic })).toBe(pic);
  });

  it('drops anything not served by Google over https ', () => {
    expect(googleAvatar({ avatar_url: 'https://evil.example/a.png' })).toBeNull();
    expect(googleAvatar({ avatar_url: 'http://lh3.googleusercontent.com/a/x' })).toBeNull();
    expect(
      googleAvatar({ avatar_url: 'https://lh3.googleusercontent.com.evil.example/a' }),
    ).toBeNull();
    expect(googleAvatar({ avatar_url: 'javascript:alert(1)' })).toBeNull();
    expect(googleAvatar({ avatar_url: 42 })).toBeNull();
    expect(googleAvatar(undefined)).toBeNull();
  });
});
