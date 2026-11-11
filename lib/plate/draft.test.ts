import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PLATE_CONSONANTS } from './chars';
import { draftToInput, plateSpoken, plateToDraft, splitPlateText } from './draft';
import { normalizePlate } from './normalize';

describe('splitPlateText', () => {
  it.each([
    ['กค7812', 'car', 'กค', '7812'],
    ['กค 7812', 'car', 'กค', '7812'],
    ['กค-7812', 'car', 'กค', '7812'],
    ['1กข1234', 'car', '1กข', '1234'],
    ['1 กข 1234', 'car', '1กข', '1234'],
    ['๑กข๑๒๓๔', 'car', '1กข', '1234'],
    ['กข12?4', 'car', 'กข', '12?4'],
    ['ก?1234', 'car', 'ก?', '1234'],
    ['ก? 1234', 'car', 'ก?', '1234'],
    ['กขค123', 'motorcycle', 'กขค', '123'],
    ['70-1234', 'other', '70', '1234'],
    ['701234', 'other', '70', '1234'],
    ['1กข', 'car', '1กข', ''],
    ['1234', 'car', '', '1234'],
    ['', 'car', '', ''],
  ] as const)('%s (%s) → %s | %s', (text, type, series, number) => {
    expect(splitPlateText(text, type)).toEqual({ series, number });
  });

  it('never loses or invents characters (only separators are dropped)', () => {
    const ch = fc.constantFrom(...PLATE_CONSONANTS, ...'0123456789? -');
    fc.assert(
      fc.property(fc.array(ch, { maxLength: 10 }), (cs) => {
        const text = cs.join('');
        const { series, number } = splitPlateText(text, 'car');
        expect(series + number).toBe(text.replace(/[\s-]/g, ''));
      }),
    );
  });
});

describe('draftToInput', () => {
  it('splits a typed plate into prefix, letters and number', () => {
    expect(draftToInput({ type: 'car', text: '1กข 1234', provinceCode: 'TH-10' })).toEqual({
      type: 'car',
      prefixDigit: '1',
      letters: 'กข',
      number: '1234',
      provinceCode: 'TH-10',
    });
  });

  it('handles plates typed without spaces', () => {
    expect(draftToInput({ type: 'car', text: 'กค7812', provinceCode: null })).toMatchObject({
      prefixDigit: null,
      letters: 'กค',
      number: '7812',
    });
  });

  it('keeps numeric bus/truck series on "other" plates as letters', () => {
    expect(draftToInput({ type: 'other', text: '70-1234', provinceCode: null })).toMatchObject({
      prefixDigit: null,
      letters: '70',
      number: '1234',
    });
  });

  it('round-trips through plateToDraft', () => {
    for (const p of [
      { type: 'car' as const, prefixDigit: '1', letters: 'กข', number: '1234' },
      { type: 'motorcycle' as const, letters: 'กขค', number: '123' },
      { type: 'other' as const, letters: '70', number: '1234' },
      { type: 'car' as const, letters: 'ก?', number: '12?4' },
    ]) {
      const plate = normalizePlate({ ...p, provinceCode: 'TH-10' });
      expect(normalizePlate(draftToInput(plateToDraft(plate)))).toEqual(plate);
    }
  });
});

describe('plateSpoken', () => {
  it('spaces characters and names unknown ones', () => {
    const plate = normalizePlate({ type: 'car', letters: 'ก?', number: '12' });
    expect(plateSpoken(plate, 'ไม่ทราบ')).toBe('ก ไม่ทราบ, 1 2');
  });
});
