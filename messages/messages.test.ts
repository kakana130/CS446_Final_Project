import { describe, expect, it } from 'vitest';
import en from './en.json';
import th from './th.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const thFlat = flatten(th);
const enFlat = flatten(en);

describe('message catalogues', () => {
  it('have exactly the same keys in Thai and English', () => {
    expect(Object.keys(enFlat).sort()).toEqual(Object.keys(thFlat).sort());
  });

  it('have no empty strings', () => {
    for (const [key, value] of Object.entries({ ...thFlat, ...enFlat })) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('use the same placeholders in both languages', () => {
    for (const key of Object.keys(thFlat)) {
      expect(placeholders(enFlat[key] ?? ''), key).toEqual(placeholders(thFlat[key] ?? ''));
    }
  });

  it('never hard-code the product name (use {brand})', () => {
    for (const [key, value] of Object.entries({ ...thFlat, ...enFlat })) {
      expect(value, key).not.toMatch(/Plate2Home|ป้ายกลับบ้าน/);
    }
  });
});
