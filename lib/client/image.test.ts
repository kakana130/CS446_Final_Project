import { describe, expect, it } from 'vitest';
import { normalizeDrag, padRect } from './image';

describe('padRect', () => {
  it('adds padding on every side', () => {
    expect(padRect({ x: 100, y: 100, width: 100, height: 50 }, 1000, 1000, 0.1)).toEqual({
      x: 90,
      y: 95,
      width: 120,
      height: 60,
    });
  });

  it('clamps to the image bounds', () => {
    expect(padRect({ x: 0, y: 0, width: 100, height: 50 }, 105, 52, 0.12)).toEqual({
      x: 0,
      y: 0,
      width: 105,
      height: 52,
    });
  });
});

describe('normalizeDrag', () => {
  it('accepts drags in any direction', () => {
    expect(normalizeDrag({ x: 50, y: 40 }, { x: 10, y: 20 }, 100, 100)).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 20,
    });
  });

  it('clamps points outside the image', () => {
    expect(normalizeDrag({ x: -10, y: -5 }, { x: 150, y: 80 }, 100, 60)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    });
  });
});
