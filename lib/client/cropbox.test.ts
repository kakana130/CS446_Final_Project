import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  contains,
  coveredBy,
  defaultBox,
  moveBox,
  nudgeBox,
  PLATE_ASPECT,
} from './cropbox';

const box = { x: 100, y: 100, width: 200, height: 100 };

describe('defaultBox', () => {
  it('is plate-shaped and centred', () => {
    const b = defaultBox(1000, 800);
    expect(b.width / b.height).toBeCloseTo(PLATE_ASPECT);
    expect(b.x + b.width / 2).toBeCloseTo(500);
    expect(b.y + b.height / 2).toBeCloseTo(400);
  });

  it('fits very wide photos', () => {
    const b = defaultBox(2000, 200);
    expect(b.height).toBeLessThanOrEqual(100);
    expect(b.width / b.height).toBeCloseTo(PLATE_ASPECT);
  });
});

describe('anchorFor', () => {
  it('returns the opposite corner', () => {
    expect(anchorFor(box, 'se')).toEqual({ x: 100, y: 100 });
    expect(anchorFor(box, 'nw')).toEqual({ x: 300, y: 200 });
    expect(anchorFor(box, 'ne')).toEqual({ x: 100, y: 200 });
    expect(anchorFor(box, 'sw')).toEqual({ x: 300, y: 100 });
  });
});

describe('moveBox', () => {
  it('moves and stays inside the photo', () => {
    expect(moveBox(box, { x: 50, y: 60 }, 1000, 800)).toMatchObject({ x: 50, y: 60 });
    expect(moveBox(box, { x: -20, y: 900 }, 1000, 800)).toMatchObject({ x: 0, y: 700 });
  });
});

describe('nudgeBox', () => {
  it('moves with arrows and resizes with shift', () => {
    expect(nudgeBox(box, 'ArrowRight', 10, false, 1000, 800, 24)).toMatchObject({ x: 110 });
    expect(nudgeBox(box, 'ArrowDown', 10, true, 1000, 800, 24)).toMatchObject({ height: 110 });
    expect(nudgeBox(box, 'ArrowLeft', 500, true, 1000, 800, 24)).toMatchObject({ width: 24 });
  });
});

describe('contains / coveredBy', () => {
  it('tests points and overlap', () => {
    expect(contains(box, { x: 150, y: 150 })).toBe(true);
    expect(contains(box, { x: 50, y: 150 })).toBe(false);
    expect(coveredBy(box, { x: 100, y: 100, width: 100, height: 100 })).toBeCloseTo(0.5);
  });
});
