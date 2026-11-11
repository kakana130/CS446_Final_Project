/**
 * Geometry for the crop box editor (move, resize by a corner, keyboard nudges). Pure, in photo
 * pixels, so it is unit-tested without a browser.
 */
import type { Rect } from './image';

export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export interface Point {
  x: number;
  y: number;
}

/** Typical car plate shape (width / height), used for the starting box. */
export const PLATE_ASPECT = 2.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A plate-shaped box in the middle of the photo, as a starting point to move and resize. */
export function defaultBox(width: number, height: number): Rect {
  let w = width * 0.5;
  let h = w / PLATE_ASPECT;
  if (h > height * 0.5) {
    h = height * 0.5;
    w = h * PLATE_ASPECT;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function contains(box: Rect, p: Point): boolean {
  return p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
}

/** The corner that stays put while `corner` is dragged. */
export function anchorFor(box: Rect, corner: Corner): Point {
  return {
    x: corner === 'nw' || corner === 'sw' ? box.x + box.width : box.x,
    y: corner === 'nw' || corner === 'ne' ? box.y + box.height : box.y,
  };
}

/** Move the box so its top-left is at `to`, keeping it fully inside the photo. */
export function moveBox(box: Rect, to: Point, width: number, height: number): Rect {
  return {
    ...box,
    x: clamp(to.x, 0, Math.max(0, width - box.width)),
    y: clamp(to.y, 0, Math.max(0, height - box.height)),
  };
}

/**
 * Keyboard editing: arrows move by `step` pixels; with `resize`, arrows grow or shrink the
 * right/bottom edges instead. Never smaller than `minEdge`, never outside the photo.
 */
export function nudgeBox(
  box: Rect,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  step: number,
  resize: boolean,
  width: number,
  height: number,
  minEdge: number,
): Rect {
  const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
  const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
  if (!resize) return moveBox(box, { x: box.x + dx, y: box.y + dy }, width, height);
  return {
    ...box,
    width: clamp(box.width + dx, minEdge, width - box.x),
    height: clamp(box.height + dy, minEdge / 2, height - box.y),
  };
}

/** How much of `a` is covered by `b` (0..1). */
export function coveredBy(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (w * h) / (a.width * a.height || 1);
}
