import { describe, expect, it } from 'vitest';
import { parsePlateText } from './parse';

describe('parsePlateText', () => {
  it.each([
    [
      'กข 1234',
      { type: 'car', prefixDigit: null, letters: 'กข', number: '1234', provinceCode: null },
    ],
    [
      '1กข 1234',
      { type: 'car', prefixDigit: '1', letters: 'กข', number: '1234', provinceCode: null },
    ],
    [
      '1 กข-1234',
      { type: 'car', prefixDigit: '1', letters: 'กข', number: '1234', provinceCode: null },
    ],
    [
      '๑กข ๑๒๓๔',
      { type: 'car', prefixDigit: '1', letters: 'กข', number: '1234', provinceCode: null },
    ],
    [
      'กขค 123',
      { type: 'motorcycle', prefixDigit: null, letters: 'กขค', number: '123', provinceCode: null },
    ],
    [
      '70-1234',
      { type: 'other', prefixDigit: null, letters: '70', number: '1234', provinceCode: null },
    ],
    [
      'กข 12?4',
      { type: 'car', prefixDigit: null, letters: 'กข', number: '12?4', provinceCode: null },
    ],
  ])('%s', (text, expected) => {
    expect(parsePlateText(text)).toEqual(expected);
  });

  it('reads a trailing province name', () => {
    expect(parsePlateText('1กข 1234 กรุงเทพมหานคร')).toMatchObject({
      number: '1234',
      provinceCode: 'TH-10',
    });
    expect(parsePlateText('กข 1234 เชียงใหม่')?.provinceCode).toBe('TH-50');
  });

  it('snaps a slightly misread province', () => {
    expect(parsePlateText('กข 1234 ขอนแกน')?.provinceCode).toBe('TH-40');
  });

  it('respects an explicit type', () => {
    expect(parsePlateText('1กข 123', 'motorcycle')?.type).toBe('motorcycle');
  });

  it('returns null for text that is not a plate', () => {
    expect(parsePlateText('')).toBeNull();
    expect(parsePlateText('สวัสดีครับ')).toBeNull();
    expect(parsePlateText('กข')).toBeNull();
    expect(parsePlateText('12345678')).toBeNull();
  });
});
