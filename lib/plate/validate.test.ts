import { describe, expect, it } from 'vitest';
import { normalizePlate } from './normalize';
import type { PlateInput } from './types';
import { validatePlate } from './validate';

const v = (input: PlateInput) => validatePlate(normalizePlate(input));

describe('private cars', () => {
  it.each([
    ['กข 1234', { letters: 'กข', number: '1234' }],
    ['1กข 1234', { prefixDigit: '1', letters: 'กข', number: '1234' }],
    ['9กก 9999 (record auction plate)', { prefixDigit: '9', letters: 'กก', number: '9999' }],
    ['กข 1', { letters: 'กข', number: '1' }],
    ['ฆฮ 5639', { letters: 'ฆฮ', number: '5639' }],
    ['legacy 3ฐ 5639', { prefixDigit: '3', letters: 'ฐ', number: '5639' }],
    ['with wildcard กข 12?4', { letters: 'กข', number: '12?4' }],
    ['wildcard letter ก? 1234', { letters: 'ก?', number: '1234' }],
  ])('%s is valid', (_, parts) => {
    const r = v({ type: 'car', provinceCode: 'TH-10', ...parts });
    expect(r).toEqual({ status: 'valid', formatId: 'car-series', issues: [] });
  });

  it.each([
    ['three letters', { letters: 'กขค', number: '1234' }, 'letters_length'],
    ['no letters', { letters: '', number: '1234' }, 'letters_missing'],
    ['five digits', { letters: 'กข', number: '12345' }, 'number_length'],
    ['no number', { letters: 'กข', number: '' }, 'number_missing'],
    ['number zero', { letters: 'กข', number: '0' }, 'number_zero'],
  ])('%s is unverified', (_, parts, issue) => {
    const r = v({ type: 'car', ...parts });
    expect(r.status).toBe('unverified');
    expect(r.formatId).toBeNull();
    expect(r.issues).toContain(issue);
  });

  it('accepts an unknown province (ไม่แน่ใจ) as valid', () => {
    expect(v({ type: 'car', letters: 'กข', number: '1234', provinceCode: null }).status).toBe(
      'valid',
    );
  });

  it('flags a province code that does not exist', () => {
    const r = v({ type: 'car', letters: 'กข', number: '1234', provinceCode: 'TH-99' });
    expect(r.status).toBe('unverified');
    expect(r.issues).toEqual(['province_unknown_code']);
  });

  it('accepts Betong', () => {
    expect(v({ type: 'car', letters: 'กข', number: '1234', provinceCode: 'TH-BTG' }).status).toBe(
      'valid',
    );
  });
});

describe('motorcycles', () => {
  it('accepts the legacy three-letter series with up to 3 digits', () => {
    expect(v({ type: 'motorcycle', letters: 'กขค', number: '999' })).toMatchObject({
      status: 'valid',
      formatId: 'motorcycle-legacy',
    });
  });

  it('accepts the digit + two-letter series with up to 4 digits', () => {
    expect(
      v({ type: 'motorcycle', prefixDigit: '1', letters: 'กข', number: '9999' }),
    ).toMatchObject({
      status: 'valid',
      formatId: 'motorcycle-digit-series',
    });
  });

  it('rejects a 4-digit number on a legacy three-letter plate', () => {
    const r = v({ type: 'motorcycle', letters: 'กขค', number: '1234' });
    expect(r.status).toBe('unverified');
  });

  it('flags two letters without the leading digit', () => {
    const r = v({ type: 'motorcycle', letters: 'กข', number: '123' });
    expect(r.status).toBe('unverified');
    expect(r.issues).toEqual(['prefix_required']);
  });

  it('flags a leading digit on a three-letter plate', () => {
    const r = v({ type: 'motorcycle', prefixDigit: '1', letters: 'กขค', number: '12' });
    expect(r.status).toBe('unverified');
  });
});

describe('other plates (relaxed)', () => {
  it.each([
    ['truck numeric series 70-1234', { letters: '70', number: '1234' }, 'other-numeric-series'],
    ['Bangkok 700+ truck series', { letters: '701', number: '2345' }, 'other-numeric-series'],
    ['taxi-style consonants', { letters: 'ทก', number: '1234' }, 'other-series'],
    ['number only', { letters: '', number: '1234' }, 'other-series'],
    ['Latin test plate', { letters: 'TC', number: '1234' }, 'other-series'],
  ])('%s is valid', (_, parts, formatId) => {
    expect(v({ type: 'other', ...parts })).toEqual({ status: 'valid', formatId, issues: [] });
  });

  it('mixed digits and letters in the series are unverified', () => {
    expect(v({ type: 'other', letters: '7ก', number: '1234' }).status).toBe('unverified');
  });
});
