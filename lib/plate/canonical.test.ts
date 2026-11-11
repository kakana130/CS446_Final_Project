import { describe, expect, it } from 'vitest';
import { buildPlateRecord, canonical, plateDisplay, plateKey } from './canonical';
import { normalizePlate } from './normalize';

describe('canonical', () => {
  it('uses type|prefix|letters|number|province with empty unknown parts', () => {
    expect(
      canonical(
        normalizePlate({
          type: 'car',
          prefixDigit: '1',
          letters: 'กข',
          number: '1234',
          provinceCode: 'TH-10',
        }),
      ),
    ).toBe('car|1|กข|1234|TH-10');
    expect(canonical(normalizePlate({ type: 'car', letters: 'กข', number: '1234' }))).toBe(
      'car||กข|1234|',
    );
  });

  it('is identical for inputs that differ only in formatting', () => {
    const a = buildPlateRecord({
      type: 'car',
      letters: 'ก ข',
      number: '๑๒๓๔',
      provinceCode: 'th-10',
    });
    const b = buildPlateRecord({
      type: 'car',
      letters: 'กข',
      number: '1234',
      provinceCode: 'TH-10',
    });
    expect(a.canonical).toBe(b.canonical);
  });
});

describe('plateKey', () => {
  it('folds confusables so near-identical plates share trigrams', () => {
    const a = plateKey(normalizePlate({ type: 'car', letters: 'ขด', number: '1880' }));
    const b = plateKey(normalizePlate({ type: 'car', letters: 'ชต', number: '1008' }));
    expect(a).toBe(b);
  });

  it('includes the prefix digit and keeps wildcards', () => {
    expect(
      plateKey(normalizePlate({ type: 'car', prefixDigit: '1', letters: 'ก?', number: '12' })),
    ).toBe('1ก?12');
  });

  it('fits the database constraint (1–16 characters) for every valid format', () => {
    const longest = plateKey(
      normalizePlate({ type: 'other', prefixDigit: '9', letters: 'ABC', number: '9999' }),
    );
    expect(longest.length).toBeLessThanOrEqual(16);
  });
});

describe('plateDisplay', () => {
  it.each([
    [{ type: 'car' as const, letters: 'กข', number: '1234' }, 'กข 1234'],
    [{ type: 'car' as const, prefixDigit: '1', letters: 'กข', number: '1234' }, '1กข 1234'],
    [{ type: 'motorcycle' as const, letters: 'กขค', number: '123' }, 'กขค 123'],
    [{ type: 'other' as const, letters: '70', number: '1234' }, '70-1234'],
    [{ type: 'other' as const, letters: '', number: '1234' }, '1234'],
    [{ type: 'car' as const, letters: 'ก?', number: '12?4' }, 'ก? 12?4'],
  ])('%j → %s', (input, expected) => {
    expect(plateDisplay(normalizePlate(input))).toBe(expected);
  });
});

describe('buildPlateRecord', () => {
  it('derives every stored field in one call', () => {
    expect(
      buildPlateRecord({ type: 'car', letters: 'กข', number: '12?4', provinceCode: 'TH-10' }),
    ).toEqual({
      plate: {
        type: 'car',
        prefixDigit: null,
        letters: 'กข',
        number: '12?4',
        provinceCode: 'TH-10',
      },
      canonical: 'car||กข|12?4|TH-10',
      key: 'กข12?4',
      display: 'กข 12?4',
      hasWildcards: true,
      validation: { status: 'valid', formatId: 'car-series', issues: [] },
    });
  });

  it('marks malformed plates unverified instead of throwing', () => {
    const r = buildPlateRecord({ type: 'car', letters: 'กขคง', number: '12345' });
    expect(r.validation.status).toBe('unverified');
    expect(r.validation.issues).toEqual(
      expect.arrayContaining(['letters_length', 'number_length']),
    );
  });

  it('clamps parts to the storable limits', () => {
    const r = buildPlateRecord({ type: 'car', letters: 'กขคงจฉ', number: '12345678' });
    expect(r.plate.letters).toBe('กขคง');
    expect(r.plate.number).toBe('12345');
    expect(r.key.length).toBeLessThanOrEqual(16);
  });
});
