import { describe, expect, it } from 'vitest';
import {
  PROVINCES,
  isKnownProvince,
  provinceByCode,
  provinceName,
  searchProvinces,
  snapProvince,
} from './provinces';

describe('province data', () => {
  it('has 77 provinces plus Betong with unique codes and names', () => {
    expect(PROVINCES).toHaveLength(78);
    expect(new Set(PROVINCES.map((p) => p.code)).size).toBe(78);
    expect(new Set(PROVINCES.map((p) => p.name_th)).size).toBe(78);
    expect(new Set(PROVINCES.map((p) => p.name_en)).size).toBe(78);
  });

  it('uses ISO 3166-2:TH codes (plus TH-BTG) and excludes Pattaya', () => {
    for (const p of PROVINCES) expect(p.code).toMatch(/^TH-(\d{2}|BTG)$/);
    expect(isKnownProvince('TH-S')).toBe(false);
    expect(isKnownProvince('TH-BTG')).toBe(true);
  });

  it('stores Thai names in NFC', () => {
    for (const p of PROVINCES) expect(p.name_th).toBe(p.name_th.normalize('NFC'));
  });

  it('looks up names by locale', () => {
    expect(provinceName('TH-10', 'th')).toBe('กรุงเทพมหานคร');
    expect(provinceName('TH-50', 'en')).toBe('Chiang Mai');
    expect(provinceName(null, 'th')).toBeNull();
    expect(provinceByCode('TH-99')).toBeUndefined();
  });
});

describe('searchProvinces', () => {
  it('finds by Thai prefix', () => {
    expect(searchProvinces('เชียง').map((p) => p.code)).toEqual(['TH-50', 'TH-57']);
  });

  it('finds by English, case-insensitively', () => {
    expect(searchProvinces('phuket')[0]?.code).toBe('TH-83');
  });

  it('finds by alias', () => {
    expect(searchProvinces('กทม')[0]?.code).toBe('TH-10');
    expect(searchProvinces('โคราช')[0]?.code).toBe('TH-30');
    expect(searchProvinces('Ayutthaya')[0]?.code).toBe('TH-14');
  });

  it('ranks prefix matches before substring matches', () => {
    const codes = searchProvinces('นคร').map((p) => p.code);
    // Provinces starting with นคร come before e.g. กรุงเทพมหานคร / พระนครศรีอยุธยา.
    expect(codes.indexOf('TH-26')).toBeLessThan(codes.indexOf('TH-10'));
    expect(codes.indexOf('TH-30')).toBeLessThan(codes.indexOf('TH-14'));
  });

  it('ignores "จังหวัด" and "จ." prefixes and spaces', () => {
    expect(searchProvinces('จังหวัดสงขลา')[0]?.code).toBe('TH-90');
    expect(searchProvinces('จ.ตรัง')[0]?.code).toBe('TH-92');
    expect(searchProvinces('chiang mai')[0]?.code).toBe('TH-50');
  });

  it('returns all provinces for an empty query and nothing for nonsense', () => {
    expect(searchProvinces('')).toHaveLength(78);
    expect(searchProvinces('zzzz')).toEqual([]);
  });
});

describe('snapProvince (OCR text → province)', () => {
  it('snaps exact names', () => {
    expect(snapProvince('กรุงเทพมหานคร')).toEqual({ code: 'TH-10', confidence: 1 });
    expect(snapProvince('เบตง')?.code).toBe('TH-BTG');
  });

  it('snaps names with one or two misread characters', () => {
    expect(snapProvince('กรุงเทพมหานดร')?.code).toBe('TH-10');
    expect(snapProvince('พระนครศรีอยธยา')?.code).toBe('TH-14');
    expect(snapProvince('ขอนแกน')?.code).toBe('TH-40');
  });

  it('snaps English OCR output', () => {
    expect(snapProvince('BANGKOK')?.code).toBe('TH-10');
  });

  it('returns null for text that is not a province', () => {
    expect(snapProvince('ป้ายทะเบียน')).toBeNull();
    expect(snapProvince('')).toBeNull();
  });

  it('returns null when two provinces are too close to call', () => {
    // One substitution away from both นครพนม (Nakhon Phanom) and นครปฐม (Nakhon Pathom).
    expect(snapProvince('นครพฐม')).toBeNull();
  });
});
