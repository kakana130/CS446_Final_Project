import { describe, expect, it } from 'vitest';
import {
  CONFUSABLE_GROUPS,
  FOLD_MAX_COST,
  confusableCost,
  foldConfusables,
} from './confusables.config';

describe('confusableCost', () => {
  it.each([
    ['ข', 'ช'],
    ['ด', 'ต'],
    ['บ', 'ป'],
    ['ภ', 'ถ'],
    ['ผ', 'พ'],
    ['พ', 'ฟ'],
    ['ฝ', 'ฟ'],
    ['ศ', 'ส'],
    ['ฎ', 'ฏ'],
    ['8', '0'],
    ['1', '7'],
  ])('%s/%s (required by the spec) is cheap', (a, b) => {
    expect(confusableCost(a, b)).toBeLessThan(1);
  });

  it('is symmetric', () => {
    for (const g of CONFUSABLE_GROUPS) {
      for (const a of g.chars) {
        for (const b of g.chars) {
          if (a !== b) expect(confusableCost(a, b)).toBe(confusableCost(b, a));
        }
      }
    }
  });

  it('returns null for unrelated characters', () => {
    expect(confusableCost('ก', 'ฮ')).toBeNull();
    expect(confusableCost('1', '2')).toBeNull();
  });

  it('never makes a confusion free', () => {
    for (const g of CONFUSABLE_GROUPS) expect(g.cost).toBeGreaterThan(0);
  });
});

describe('foldConfusables', () => {
  it('folds every strong pair to the same representative', () => {
    for (const g of CONFUSABLE_GROUPS.filter((x) => x.cost <= FOLD_MAX_COST)) {
      const folded = new Set(g.chars.map(foldConfusables));
      expect(folded.size, g.chars.join('/')).toBe(1);
    }
  });

  it('is transitive: ข ช ซ fold together because ข/ช and ช/ซ are strong', () => {
    expect(foldConfusables('ข')).toBe(foldConfusables('ซ'));
  });

  it('does not fold weak pairs', () => {
    expect(foldConfusables('อ')).not.toBe(foldConfusables('ฮ'));
    expect(foldConfusables('5')).not.toBe(foldConfusables('6'));
  });

  it('is idempotent and leaves wildcards and unrelated characters alone', () => {
    const s = 'กขด8?1';
    expect(foldConfusables(foldConfusables(s))).toBe(foldConfusables(s));
    expect(foldConfusables('ก?')).toBe('ก?');
  });
});
