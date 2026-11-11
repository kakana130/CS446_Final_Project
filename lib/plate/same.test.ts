import { describe, expect, it } from 'vitest';
import { normalizePlate } from './normalize';
import { samePlate } from './same';

const plate = (
  letters: string,
  number: string,
  provinceCode: string | null = 'TH-10',
  extra = {},
) => normalizePlate({ type: 'car', letters, number, provinceCode, ...extra });

describe('samePlate', () => {
  it('matches the same plate however it was typed', () => {
    expect(samePlate(plate('กข', '1234'), plate(' กข', '1234 '))).toBe(true);
    expect(samePlate(plate('กข', '๑๒๓๔'), plate('กข', '1234'))).toBe(true);
  });

  it('lets an unknown province agree with any province', () => {
    expect(samePlate(plate('กข', '1234', null), plate('กข', '1234', 'TH-50'))).toBe(true);
    expect(samePlate(plate('กข', '1234', 'TH-10'), plate('กข', '1234', 'TH-50'))).toBe(false);
  });

  it('tells apart different numbers, letters, prefixes and plate types', () => {
    expect(samePlate(plate('กข', '1234'), plate('กข', '1235'))).toBe(false);
    expect(samePlate(plate('กข', '1234'), plate('กค', '1234'))).toBe(false);
    expect(samePlate(plate('กข', '1234', null, { prefixDigit: '1' }), plate('กข', '1234'))).toBe(
      false,
    );
    expect(
      samePlate(plate('กข', '1234'), plate('กข', '1234', 'TH-10', { type: 'motorcycle' })),
    ).toBe(false);
  });

  it('never calls a plate with an unreadable character the same', () => {
    expect(samePlate(plate('ก?', '1234'), plate('ก?', '1234'))).toBe(false);
    expect(samePlate(plate('กข', '12?4'), plate('กข', '1234'))).toBe(false);
  });
});
