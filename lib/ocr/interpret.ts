/**
 * Turning raw OCR output (Tesseract lines/words with boxes and confidences) into plate readings
 * and plate-shaped regions. Pure functions: unit-tested without the OCR engine.
 *
 * This is the recognizer/detector *fallback* of spec §7.1 (text spotting with a general Thai OCR
 * model). A trained plate detector + recognizer (Phase 6) will replace it; the output here is
 * always shown to the user for confirmation.
 */
import { isAsciiDigit, isPlateConsonant } from '@/lib/plate/chars';
import { cleanChars } from '@/lib/plate/normalize';
import { snapProvince } from '@/lib/plate/provinces';
import type { PlateType } from '@/lib/plate/types';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrSymbol {
  text: string;
  confidence: number;
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: Box;
  symbols?: OcrSymbol[];
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: Box;
}

export interface PlateReading {
  /** Plate text as typed in the plate input, e.g. "1กข 1234". */
  text: string;
  provinceCode: string | null;
  /** Mean OCR confidence of the plate characters, 0..1. */
  confidence: number;
  /** Box of the plate-number line inside the image, for a focused second pass. */
  lineBox: Box | null;
}

/** Characters read with less confidence than this (0..100) become `?`. */
export const UNSURE_CHAR = 35;

interface Shape {
  letters: string;
  digits: string;
  /** Leading digit before the letters ("1กข"). */
  prefix: string;
}

/**
 * Keep only plate characters and describe the line: [prefix digit] letters digits.
 * `maxDigits` is relaxed when *finding* plates: plate borders are often read as extra digits,
 * and the region is read again, carefully, on its own crop.
 */
function shapeOf(text: string, maxDigits = 4): Shape | null {
  const chars = cleanChars(text).filter((c) => isPlateConsonant(c) || isAsciiDigit(c) || c === '?');
  const m = chars
    .join('')
    .match(new RegExp(`^([0-9])?([\u0E01-\u0E2E?]{0,3})([0-9?]{0,${maxDigits}})$`, 'u'));
  if (!m) return null;
  const prefix = m[1] ?? '';
  const letters = m[2] ?? '';
  // Without letters there is no leading digit: "123" is a number, not "1" + "23".
  if (!letters) return { prefix: '', letters, digits: prefix + (m[3] ?? '') };
  return { prefix, letters, digits: m[3] ?? '' };
}

/**
 * Plate numbers have at most 4 digits; extra ones are almost always the plate border on the
 * right read as "68"/"11". Keep the first 4 and mark the reading as less certain.
 */
function trimDigits(shape: Shape | null): (Shape & { trimmed: boolean }) | null {
  if (!shape) return null;
  if (shape.digits.length <= 4) return { ...shape, trimmed: false };
  return { ...shape, digits: shape.digits.slice(0, 4), trimmed: true };
}

/** Confidence penalty when digits had to be trimmed. */
const TRIM_PENALTY = 0.7;

const isSeriesAndNumber = (s: Shape) => s.letters.length >= 1 && s.digits.length >= 1;
const isSeriesOnly = (s: Shape) => s.letters.length >= 2 && s.digits.length === 0;
const isNumberOnly = (s: Shape) =>
  s.letters.length === 0 && s.prefix === '' && s.digits.length >= 1;

/** Replace characters read with low confidence by `?` (keeps the matcher honest). */
export function maskUnsure(text: string, symbols: OcrSymbol[] | undefined): string {
  if (!symbols?.length) return text;
  const unsure = new Set(
    symbols.filter((s) => s.confidence < UNSURE_CHAR && s.text.trim()).map((s) => s.text),
  );
  if (unsure.size === 0) return text;
  // Map by position over the plate characters only.
  const plateSymbols = symbols.filter((s) => shapeOf(s.text) !== null && s.text.trim());
  let i = 0;
  return [...text]
    .map((c) => {
      if (c === ' ') return c;
      const sym = plateSymbols[i++];
      return sym && sym.confidence < UNSURE_CHAR ? '?' : c;
    })
    .join('');
}

/**
 * Pick the plate number line(s) and the province line out of OCR lines from a plate crop.
 * Cars: one line "กข 1234" + province. Motorcycles: series, province, number on three lines.
 */
/**
 * Shape of a line, tolerating stray tokens at its edges: plate borders and screws are often
 * read as a lone "ป" or "|" ("ป กท 2058 ป").
 */
function lineShape(text: string, type: PlateType) {
  const tokens = text.trim().split(/\s+/);
  const standardLetters = type === 'motorcycle' ? [2, 3] : [1, 2];
  let best: { shape: ReturnType<typeof trimDigits>; score: number } | null = null;
  for (const [from, to] of [
    [0, tokens.length],
    [1, tokens.length],
    [0, tokens.length - 1],
    [1, tokens.length - 1],
  ] as const) {
    if (to - from < 1) continue;
    const shape = trimDigits(shapeOf(tokens.slice(from, to).join(' '), 6));
    if (!shape) continue;
    const dropped = from + (tokens.length - to);
    const standard =
      shape.letters.length >= standardLetters[0]! && shape.letters.length <= standardLetters[1]!;
    const score = (standard ? 10 : 0) - dropped;
    if (!best || score > best.score) best = { shape, score };
  }
  return best?.shape ?? null;
}

export function interpretPlateLines(lines: OcrLine[], type: PlateType): PlateReading | null {
  const shaped = lines
    .map((line) => ({ line, shape: lineShape(line.text, type) }))
    .filter((x) => x.line.text.trim().length > 0);

  let text: string | null = null;
  let confidence = 0;
  let lineBox: Box | null = null;
  const used = new Set<OcrLine>();

  const combined = shaped
    .filter((x) => x.shape && isSeriesAndNumber(x.shape))
    .sort((a, b) => b.line.confidence - a.line.confidence)[0];

  if (combined && type !== 'motorcycle') {
    const s = combined.shape!;
    text = maskUnsure(`${s.prefix}${s.letters} ${s.digits}`, combined.line.symbols);
    confidence = (combined.line.confidence / 100) * (s.trimmed ? TRIM_PENALTY : 1);
    lineBox = combined.line.bbox;
    used.add(combined.line);
  } else {
    const series = shaped.find((x) => x.shape && isSeriesOnly(x.shape));
    const number = shaped.find((x) => x.shape && isNumberOnly(x.shape) && x !== series);
    if (series && number) {
      text = `${series.shape!.prefix}${series.shape!.letters} ${number.shape!.digits}`;
      confidence = Math.min(series.line.confidence, number.line.confidence) / 100;
      lineBox = series.line.bbox;
      used.add(series.line).add(number.line);
    } else if (combined) {
      const s = combined.shape!;
      text = `${s.prefix}${s.letters} ${s.digits}`;
      confidence = combined.line.confidence / 100;
      lineBox = combined.line.bbox;
      used.add(combined.line);
    }
  }
  if (!text) return null;

  // The province is whichever remaining line snaps best to a province name.
  let provinceCode: string | null = null;
  let best = 0;
  for (const { line } of shaped) {
    if (used.has(line)) continue;
    const snap = snapProvince(line.text);
    if (snap && snap.confidence > best) {
      best = snap.confidence;
      provinceCode = snap.code;
    }
  }

  return { text, provinceCode, confidence: Math.max(0, Math.min(1, confidence)), lineBox };
}

function overlapY(a: Box, b: Box): number {
  const top = Math.max(a.y0, b.y0);
  const bottom = Math.min(a.y1, b.y1);
  return Math.max(0, bottom - top) / Math.min(a.y1 - a.y0, b.y1 - b.y0 || 1);
}

export function iou(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = w * h;
  const area = (r: Box) => (r.x1 - r.x0) * (r.y1 - r.y0);
  return inter / (area(a) + area(b) - inter || 1);
}

const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

export interface OcrWordLine {
  words: OcrWord[];
}

/**
 * Plate-shaped regions in a whole photo, from OCR lines. Thai has no spaces, so the OCR engine
 * often returns letters as separate "words"; within each line, words closer than ~1.2× the text
 * height are grouped, and a group that reads like a plate number ("กข 1234", "1กข1234") becomes a
 * region. The text box is grown to cover the whole plate (margins, and the province line below).
 * Overlapping regions are merged.
 */
export function findPlateRegions(lines: OcrWordLine[], width: number, height: number): Box[] {
  const textBoxes: Box[] = [];
  for (const line of lines) {
    const words = [...line.words]
      .filter((w) => w.text.trim())
      .sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let group: OcrWord[] = [];
    const flush = () => {
      // Plate borders come back as tall stray "letters" at the edges; measure the box from the
      // plate characters only, so it doesn't swallow the province line below.
      let best: Box | null = null;
      for (const [from, to] of [
        [0, group.length],
        [1, group.length],
        [0, group.length - 1],
        [1, group.length - 1],
      ] as const) {
        const part = group.slice(from, to);
        if (part.length === 0) continue;
        const shape = shapeOf(part.map((w) => w.text).join(''), 6);
        if (!shape || !isSeriesAndNumber(shape)) continue;
        const b = part.map((w) => w.bbox).reduce(union);
        if (!best || b.y1 - b.y0 < best.y1 - best.y0) best = b;
      }
      if (best) textBoxes.push(best);
      group = [];
    };
    for (const w of words) {
      const prev = group[group.length - 1];
      if (prev) {
        const h = Math.max(prev.bbox.y1 - prev.bbox.y0, w.bbox.y1 - w.bbox.y0);
        const gap = w.bbox.x0 - prev.bbox.x1;
        if (gap > h * 1.2 || overlapY(prev.bbox, w.bbox) < 0.3) flush();
      }
      group.push(w);
    }
    flush();
  }

  const regions: Box[] = [];
  for (const b of textBoxes) {
    const grown = growPlateBox(b, width, height);
    const dup = regions.findIndex((r) => iou(r, grown) > 0.3);
    if (dup >= 0) regions[dup] = union(regions[dup]!, grown);
    else regions.push(grown);
  }
  return regions;
}

/**
 * The whole plate around its number line: side margins, the top edge, and the province line
 * below (car plates). Generous on purpose: it seeds a box the user adjusts, and cutting into
 * the plate is worse than a little background. Clamped to the image.
 */
export function growPlateBox(line: Box, width: number, height: number): Box {
  const h = line.y1 - line.y0;
  return {
    x0: Math.max(0, line.x0 - h * 0.7),
    y0: Math.max(0, line.y0 - h * 0.7),
    x1: Math.min(width, line.x1 + h * 0.7),
    y1: Math.min(height, line.y1 + h * 1.6),
  };
}
