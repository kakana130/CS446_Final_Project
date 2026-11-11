import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editDistance, similarity } from './distance';

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['abc', 'abd', 1],
    ['abc', 'ab', 1],
    ['ab', 'abc', 1],
    ['abcd', 'abdc', 1], // adjacent transposition
    ['กข', 'ขก', 1],
    ['kitten', 'sitting', 3],
  ])('%s → %s = %d', (a, b, d) => {
    expect(editDistance(a, b)).toBe(d);
  });

  it('works on code points, not UTF-16 units', () => {
    expect(editDistance('ก', 'ข')).toBe(1);
    expect(editDistance('😀', '😃')).toBe(1);
  });

  it('uses custom costs', () => {
    const costs = { substitute: () => 0.3, insert: 2, delete: 2, transpose: 0.5 };
    expect(editDistance('ab', 'ac', costs)).toBeCloseTo(0.3);
    expect(editDistance('ab', 'ba', costs)).toBeCloseTo(0.5);
    expect(editDistance('a', 'ab', costs)).toBe(2);
  });

  const str = fc.string({ maxLength: 8 });

  it('is symmetric with unit costs', () => {
    fc.assert(fc.property(str, str, (a, b) => editDistance(a, b) === editDistance(b, a)));
  });

  it('is zero exactly for equal strings', () => {
    fc.assert(fc.property(str, str, (a, b) => (editDistance(a, b) === 0) === (a === b)));
  });

  it('is bounded by the longer length', () => {
    fc.assert(
      fc.property(str, str, (a, b) => editDistance(a, b) <= Math.max([...a].length, [...b].length)),
    );
  });
});

describe('similarity', () => {
  it('is 1 for equal and empty strings, 0 for fully different ones', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });
});
