import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PLATE_CONSONANTS } from './chars';
import {
  cleanChars,
  hasWildcards,
  normalizeLetters,
  normalizeNumber,
  normalizePlate,
  normalizePrefix,
} from './normalize';

describe('cleanChars', () => {
  it('converts Thai digits to Arabic', () => {
    expect(cleanChars('๑๒๓๔').join('')).toBe('1234');
  });

  it('drops whitespace and separators', () => {
    expect(cleanChars(' กข - 1 2.3,4 ').join('')).toBe('กข1234');
  });

  it('maps wildcard aliases to ?', () => {
    expect(cleanChars('1？3*_•').join('')).toBe('1?3???');
  });

  it('drops Thai vowels and tone marks typed by accident', () => {
    expect(cleanChars('กา ข่ ค์').join('')).toBe('กขค');
  });

  it('applies NFC so decomposed input compares equal', () => {
    // "ำ" (U+0E33) vs "ํา" (U+0E4D U+0E32) are both dropped anyway; check NFC on Latin too.
    expect(cleanChars('é').join('')).toBe('É');
  });

  it('handles null and empty input', () => {
    expect(cleanChars(null)).toEqual([]);
    expect(cleanChars('')).toEqual([]);
  });
});

describe('normalizeLetters', () => {
  it('keeps only plate consonants for cars and motorcycles', () => {
    expect(normalizeLetters('ก ข', 'car')).toBe('กข');
    expect(normalizeLetters('กA1ข', 'car')).toBe('กข');
    expect(normalizeLetters('กขค', 'motorcycle')).toBe('กขค');
  });

  it('never keeps obsolete ฃ ฅ or the vowels ฤ ฦ', () => {
    expect(normalizeLetters('ฃฅฤฦก', 'car')).toBe('ก');
  });

  it('keeps digits and Latin for "other" plates (numeric series, test plates)', () => {
    expect(normalizeLetters('70', 'other')).toBe('70');
    expect(normalizeLetters('tc', 'other')).toBe('TC');
  });

  it('keeps wildcards', () => {
    expect(normalizeLetters('ก?', 'car')).toBe('ก?');
  });
});

describe('normalizeNumber', () => {
  it('keeps digits and wildcards only', () => {
    expect(normalizeNumber('12a3?')).toBe('123?');
  });

  it('drops leading zeros but keeps a lone zero', () => {
    expect(normalizeNumber('0123')).toBe('123');
    expect(normalizeNumber('000')).toBe('0');
  });

  it('does not treat a leading wildcard as a zero', () => {
    expect(normalizeNumber('?012')).toBe('?012');
  });

  it('converts Thai digits', () => {
    expect(normalizeNumber('๙๙๙๙')).toBe('9999');
  });
});

describe('normalizePrefix', () => {
  it('takes one digit or wildcard', () => {
    expect(normalizePrefix('1')).toBe('1');
    expect(normalizePrefix('๒')).toBe('2');
    expect(normalizePrefix('?')).toBe('?');
    expect(normalizePrefix(' ')).toBeNull();
    expect(normalizePrefix(null)).toBeNull();
    expect(normalizePrefix('ก')).toBeNull();
  });
});

describe('normalizePlate', () => {
  it('normalizes every part and the province code', () => {
    expect(
      normalizePlate({
        type: 'car',
        prefixDigit: '๑',
        letters: ' ก ข ',
        number: '๐๑๒๓',
        provinceCode: ' th-10 ',
      }),
    ).toEqual({
      type: 'car',
      prefixDigit: '1',
      letters: 'กข',
      number: '123',
      provinceCode: 'TH-10',
    });
  });

  it('treats an empty province as unknown', () => {
    expect(
      normalizePlate({ type: 'car', letters: 'กข', number: '1', provinceCode: '' }).provinceCode,
    ).toBeNull();
  });

  it('detects wildcards in any part', () => {
    expect(hasWildcards(normalizePlate({ type: 'car', letters: 'กข', number: '12?4' }))).toBe(true);
    expect(
      hasWildcards(normalizePlate({ type: 'car', prefixDigit: '?', letters: 'กข', number: '1' })),
    ).toBe(true);
    expect(hasWildcards(normalizePlate({ type: 'car', letters: 'กข', number: '1234' }))).toBe(
      false,
    );
  });
});

describe('normalization properties', () => {
  const plateChar = fc.constantFrom(
    ...PLATE_CONSONANTS,
    ...'0123456789๐๑๒๓๔๕๖๗๘๙?*_ -.าิ่้'.split(''),
  );
  const text = fc.array(plateChar, { maxLength: 12 }).map((cs) => cs.join(''));
  const type = fc.constantFrom('car' as const, 'motorcycle' as const, 'other' as const);

  it('is idempotent', () => {
    fc.assert(
      fc.property(type, text, text, text, (t, p, l, n) => {
        const once = normalizePlate({ type: t, prefixDigit: p, letters: l, number: n });
        const twice = normalizePlate(once);
        expect(twice).toEqual(once);
      }),
    );
  });

  it('never outputs whitespace, Thai digits or vowels', () => {
    fc.assert(
      fc.property(type, text, text, (t, l, n) => {
        const out = normalizePlate({ type: t, letters: l, number: n });
        expect(out.letters + out.number).not.toMatch(/[\s๐-๙ะ-๎]/u);
      }),
    );
  });
});
