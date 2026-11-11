/**
 * In-browser plate OCR with Tesseract.js (Thai LSTM model, Apache-2.0), running in its own Web
 * Worker. Everything is self-hosted under /tesseract and loaded only when the found flow needs it.
 *
 *  - findPlates(photo):   plates in a whole photo (layout detector; text spotting fallback)
 *  - readPlate(crop):     reads the plate number and province from one crop
 *
 * This is the fallback recognizer of spec §7.1 until a trained plate model exists (Phase 6).
 * Results are always prefilled for the user to confirm, never trusted blindly.
 */
import type Tesseract from 'tesseract.js';
import {
  dedupe,
  downscale,
  estimateSkew,
  flattenLighting,
  findPlatesInLayout,
  LINE_WORK_WIDTH,
  otsu,
  plateTextLines,
  WORK_WIDTH,
} from '@/lib/ocr/layout';
import {
  loadRecognizer,
  recognizePlate,
  resizeBilinear,
  toInput,
  type RecognizerModel,
} from '@/lib/ocr/recognizer';
import {
  type Box,
  findPlateRegions,
  interpretPlateLines,
  type OcrLine,
  type OcrWordLine,
  type PlateReading,
} from '@/lib/ocr/interpret';
import { PLATE_CONSONANTS } from '@/lib/plate/chars';
import { snapProvince } from '@/lib/plate/provinces';
import type { PlateType } from '@/lib/plate/types';
import type { LoadedPhoto, Rect } from './image';

/** On by default; NEXT_PUBLIC_FEATURE_OCR=false turns it off (manual entry always works). */
export const OCR_ENABLED = process.env.NEXT_PUBLIC_FEATURE_OCR !== 'false';

const ASSETS = '/tesseract';
const WHITELIST = `${PLATE_CONSONANTS.join('')}0123456789 `;
/** Plate-text recognizer trained on the plate font (ml/recognizer, D-074). */
const MODEL_URL = '/models/plate-rec.bin';

const models = new Map<string, Promise<RecognizerModel | null>>();
function modelAt(url: string): Promise<RecognizerModel | null> {
  let p = models.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? loadRecognizer(b) : null))
      .catch(() => null);
    models.set(url, p);
  }
  return p;
}

/**
 * A text line as model input, the same way training images were made (synth.to_input): cut
 * out with a margin, grey, Pillow-style bilinear resize to the model height, padded.
 */
function modelInput(
  source: HTMLCanvasElement,
  box: Box,
  model: RecognizerModel,
  margin: [number, number] = [0.15, 0.2],
): Float32Array {
  const bh = box.y1 - box.y0;
  const sx = Math.max(0, Math.round(box.x0 - bh * margin[0]));
  const sy = Math.max(0, Math.round(box.y0 - bh * margin[1]));
  const sw = Math.max(1, Math.min(source.width, Math.round(box.x1 + bh * margin[0])) - sx);
  const sh = Math.max(1, Math.min(source.height, Math.round(box.y1 + bh * margin[1])) - sy);
  const d = source
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(sx, sy, sw, sh).data;
  const grey = new Float32Array(sw * sh);
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) {
    grey[j] = Math.round((d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000);
  }
  // Even out shadows and gradients first (D-083); the model still gets grey levels.
  const flat = flattenLighting(grey, sw, sh, bh * 0.25);
  const tw = Math.min(model.width, Math.max(1, Math.round((sw * model.height) / sh)));
  return toInput(resizeBilinear(flat, sw, sh, tw, model.height), tw, model);
}

type TWorker = Tesseract.Worker;
let workerPromise: Promise<TWorker> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const loadListeners = new Set<(progress: number) => void>();

/** Subscribe to first-load progress (downloading the engine and the Thai model). */
export function onOcrLoading(listener: (progress: number) => void): () => void {
  loadListeners.add(listener);
  return () => loadListeners.delete(listener);
}

function worker(): Promise<TWorker> {
  workerPromise ??= import('tesseract.js')
    .then((T) =>
      T.createWorker('tha', T.OEM.LSTM_ONLY, {
        workerPath: `${ASSETS}/worker.min.js`,
        corePath: `${ASSETS}/core`,
        langPath: `${ASSETS}/lang`,
        gzip: true,
        workerBlobURL: false,
        logger: (m: { status: string; progress: number }) => {
          if (m.status !== 'recognizing text') loadListeners.forEach((l) => l(m.progress));
        },
      }),
    )
    .catch((err: unknown) => {
      workerPromise = null;
      throw err;
    });
  return workerPromise;
}

/** One job at a time: parameters are per worker, so jobs must not interleave. */
function exclusive<T>(job: (w: TWorker) => Promise<T>): Promise<T> {
  const run = queue.then(async () => job(await worker()));
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Plate borders are long straight dark lines; OCR reads them as letters ("ป") and they merge
 * the number and province rows into one line. An unbroken dark run longer than any character
 * stroke (35% of the width across, 55% of the height down) is a border, so it is painted
 * white. Runs, not totals, so it also works when the crop has margin around the plate.
 * Works on RGBA grey pixels.
 */
function eraseLongLines(d: Uint8ClampedArray, width: number, height: number) {
  const dark = (x: number, y: number) => d[(y * width + x) * 4]! < 110;
  const paint = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255;
  };
  const runs: [number, number, number, boolean][] = []; // [fixed, from, to, isRow]
  for (let y = 0; y < height; y++) {
    for (let x = 0, from = -1; x <= width; x++) {
      if (x < width && dark(x, y)) {
        if (from < 0) from = x;
      } else if (from >= 0) {
        if (x - from > width * 0.35) runs.push([y, from, x, true]);
        from = -1;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0, from = -1; y <= height; y++) {
      if (y < height && dark(x, y)) {
        if (from < 0) from = y;
      } else if (from >= 0) {
        if (y - from > height * 0.55) runs.push([x, from, y, false]);
        from = -1;
      }
    }
  }
  for (const [fixed, from, to, isRow] of runs) {
    for (let v = from; v < to; v++) {
      if (isRow) paint(v, fixed);
      else paint(fixed, v);
    }
  }
}

/** Grey, contrast-stretched copy, scaled so text is a comfortable size for the OCR model. */
function prepare(
  source: CanvasImageSource,
  width: number,
  height: number,
  minHeight: number,
  maxWidth: number,
  removeLines = false,
) {
  const scale = Math.min(maxWidth / width, Math.max(1, minHeight / height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const grey = new Uint8ClampedArray(d.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
    grey[j] = g;
    hist[grey[j]!]!++;
  }
  // Stretch between the 2nd and 98th percentiles: muddy, low-contrast plates read better.
  const total = grey.length;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]!) < total * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]!) < total * 0.02; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((grey[j]! - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  if (removeLines) eraseLongLines(d, canvas.width, canvas.height);
  ctx.putImageData(img, 0, 0);
  return { canvas, scale };
}

function ocrLinesOf(page: Tesseract.Page): OcrLine[] {
  return (page.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        text: l.text,
        confidence: l.confidence,
        bbox: l.bbox,
        symbols: l.words.flatMap((w) =>
          w.symbols.map((s) => ({ text: s.text, confidence: s.confidence })),
        ),
      })),
    ),
  );
}

function wordLinesOf(page: Tesseract.Page): OcrWordLine[] {
  return (page.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
      })),
    ),
  );
}

/** Read one plate crop: plate number (with low-confidence characters as `?`) and province. */
export async function readPlate(crop: Blob, type: PlateType): Promise<PlateReading | null> {
  const bitmap = await createImageBitmap(crop);
  try {
    return await readSource(bitmap, bitmap.width, bitmap.height, type);
  } finally {
    bitmap.close();
  }
}

/**
 * Pixels of a crop, levelled and at least LINE_WORK_WIDTH wide, and its text lines (in the
 * returned canvas's pixels) if found.
 */
function cropLines(source: CanvasImageSource, width: number, height: number) {
  // Small crops are upscaled first: line finding and reading work on bigger letters (D-083).
  const zoom = Math.min(4, Math.max(1, LINE_WORK_WIDTH / width));
  const cw = Math.round(width * zoom);
  const ch = Math.round(height * zoom);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, cw, ch);
  let small = downscale(ctx.getImageData(0, 0, cw, ch).data, cw, ch, LINE_WORK_WIDTH);
  // A tilted plate: turn it level first, filling the corners with the crop's edge colour
  // (usually what the plate lies on) (D-083).
  const skew = estimateSkew(small.data, small.width, small.height);
  if (Math.abs(skew) >= 1.5) {
    const [r, g, b] = edgeColour(small.data, small.width, small.height);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((-skew * Math.PI) / 180);
    ctx.drawImage(source, -cw / 2, -ch / 2, cw, ch);
    ctx.restore();
    small = downscale(ctx.getImageData(0, 0, cw, ch).data, cw, ch, LINE_WORK_WIDTH);
  }
  const found = plateTextLines(small.data, small.width, small.height);
  const up = (b: Box): Box => ({
    x0: b.x0 / small.scale,
    y0: b.y0 / small.scale,
    x1: b.x1 / small.scale,
    y1: b.y1 / small.scale,
  });
  return {
    canvas,
    lines: found && { number: up(found.number), province: found.province && up(found.province) },
  };
}

/** Median colour of the outermost pixel ring of an RGBA image. */
function edgeColour(rgba: ArrayLike<number>, w: number, h: number): number[] {
  const ring: number[] = [];
  for (let x = 0; x < w; x++) ring.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) ring.push(y * w, y * w + w - 1);
  return [0, 1, 2].map((c) => {
    const v = ring.map((i) => rgba[i * 4 + c]!).sort((p, q) => p - q);
    return v[v.length >> 1]!;
  });
}

/**
 * One text line, cut out with a margin, scaled so the text is `textHeight` px tall and
 * binarized (Otsu), on a white border: the input Tesseract reads best.
 */
function lineImage(source: HTMLCanvasElement, box: Box, textHeight: number) {
  const bh = box.y1 - box.y0;
  const px = bh * 0.15;
  const py = bh * 0.2;
  const sx = Math.max(0, box.x0 - px);
  const sy = Math.max(0, box.y0 - py);
  const sw = Math.min(source.width, box.x1 + px) - sx;
  const sh = Math.min(source.height, box.y1 + py) - sy;
  const scale = textHeight / bh;
  const border = 16;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale) + border * 2;
  canvas.height = Math.round(sh * scale) + border * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    border,
    border,
    canvas.width - border * 2,
    canvas.height - border * 2,
  );
  const img = ctx.getImageData(
    border,
    border,
    canvas.width - border * 2,
    canvas.height - border * 2,
  );
  const d = img.data;
  const raw = new Uint8Array(d.length / 4);
  for (let i = 0, j = 0; j < raw.length; i += 4, j++) {
    raw[j] = (d[i]! * 299 + d[i + 1]! * 587 + d[i + 2]! * 114) / 1000;
  }
  // Even out lighting, then one threshold works across the whole line (D-083).
  const grey = Uint8Array.from(flattenLighting(raw, img.width, img.height, textHeight * 0.25));
  const t = otsu(grey);
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) {
    const v = grey[j]! <= t ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, border, border);
  return canvas;
}

async function readSource(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: PlateType,
): Promise<PlateReading | null> {
  const { canvas } = prepare(source, width, height, 320, 1400, true);
  const found = type === 'motorcycle' ? null : cropLines(source, width, height);
  const model = found?.lines ? await modelAt(MODEL_URL) : null;

  return exclusive(async (w) => {
    const T = await import('tesseract.js');

    // 0. The trained recognizer reads the number line (D-074); OCR only reads the province.
    if (model && found?.lines) {
      const { number, province } = found.lines;
      // Three slightly different cuts of the line; keep the most confident reading.
      const rec = (
        [
          [0.15, 0.2],
          [0.08, 0.1],
          [0.25, 0.32],
        ] as [number, number][]
      )
        .map((m) => recognizePlate(model, modelInput(found.canvas, number, model, m)))
        .reduce((a, b) => (b.confidence > a.confidence ? b : a));
      let split = rec.text.length;
      while (split > 0 && /[0-9]/.test(rec.text[split - 1]!)) split--;
      const numberLine: OcrLine = {
        text: `${rec.text.slice(0, split)} ${rec.text.slice(split)}`,
        confidence: rec.confidence * 100,
        bbox: number,
        symbols: [...rec.text].map((c, i) => ({ text: c, confidence: rec.probs[i]! * 100 })),
      };
      // The province: OCR the line and snap it to the province list.
      let provinceLine: OcrLine | null = null;
      if (province) {
        await w.setParameters({
          tessedit_pageseg_mode: T.PSM.SINGLE_LINE,
          tessedit_char_whitelist: '',
        });
        const res = await w.recognize(lineImage(found.canvas, province, 48), {}, { text: true });
        provinceLine = { text: res.data.text, confidence: res.data.confidence, bbox: province };
      }
      const r = interpretPlateLines(provinceLine ? [numberLine, provinceLine] : [numberLine], type);
      // Even when unsure, the trained model beats OCR on plate glyphs: unsure characters are
      // already "?" and the low confidence is shown to the user.
      if (r) return r;
    }

    // 1. Line by line (D-073): the number line with plate characters only, at two sizes,
    //    and the province line on its own.
    if (found?.lines) {
      const { number, province } = found.lines;
      const readLine = async (box: Box, textHeight: number, whitelist: string) => {
        await w.setParameters({
          tessedit_pageseg_mode: T.PSM.SINGLE_LINE,
          tessedit_char_whitelist: whitelist,
        });
        const res = await w.recognize(
          lineImage(found.canvas, box, textHeight),
          {},
          { blocks: true, text: true },
        );
        const ls = ocrLinesOf(res.data);
        return {
          text: ls.map((l) => l.text).join(' '),
          confidence: ls.length ? Math.min(...ls.map((l) => l.confidence)) : 0,
          bbox: box,
          symbols: ls.flatMap((l) => l.symbols ?? []),
        };
      };
      const provinceLine = province ? await readLine(province, 48, '') : null;
      let best: PlateReading | null = null;
      for (const textHeight of [64, 96]) {
        const numberLine = await readLine(number, textHeight, WHITELIST);
        const r = interpretPlateLines(
          provinceLine ? [numberLine, provinceLine] : [numberLine],
          type,
        );
        if (r && (!best || r.confidence > best.confidence)) best = r;
      }
      if (best && best.confidence >= 0.5) return best;
    }

    // 2. Fallback: let OCR analyse the whole crop.
    // Page layout analysis handles plate borders better than "single block" (which reads the
    // borders as letters); fall back to single block if it finds nothing plate-like.
    let reading: PlateReading | null = null;
    for (const psm of [T.PSM.AUTO, T.PSM.SINGLE_BLOCK]) {
      await w.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: '' });
      const pass = await w.recognize(canvas, {}, { blocks: true, text: true });
      reading = interpretPlateLines(ocrLinesOf(pass.data), type);
      if (reading) break;
    }
    // Second, focused pass on the plate-number line with plate characters only.
    if (reading?.lineBox && type !== 'motorcycle') {
      const b = reading.lineBox;
      const pad = (b.y1 - b.y0) * 0.25;
      await w.setParameters({
        tessedit_pageseg_mode: T.PSM.SINGLE_LINE,
        tessedit_char_whitelist: WHITELIST,
      });
      const second = await w.recognize(
        canvas,
        {
          rectangle: {
            left: Math.max(0, Math.round(b.x0 - pad)),
            top: Math.max(0, Math.round(b.y0 - pad)),
            width: Math.min(canvas.width, Math.round(b.x1 - b.x0 + pad * 2)),
            height: Math.min(canvas.height, Math.round(b.y1 - b.y0 + pad * 2)),
          },
        },
        { blocks: true, text: true },
      );
      const refined = interpretPlateLines(ocrLinesOf(second.data), type);
      if (refined && refined.confidence >= reading.confidence) {
        reading = { ...refined, provinceCode: reading.provinceCode };
      }
    }
    // Province still unknown: read the strip below the number line on its own.
    if (reading?.lineBox && !reading.provinceCode && type !== 'motorcycle') {
      const top = Math.round(reading.lineBox.y1);
      if (canvas.height - top > canvas.height * 0.12) {
        await w.setParameters({
          tessedit_pageseg_mode: T.PSM.SINGLE_LINE,
          tessedit_char_whitelist: '',
        });
        const below = await w.recognize(
          canvas,
          { rectangle: { left: 0, top, width: canvas.width, height: canvas.height - top } },
          { text: true },
        );
        const snap = snapProvince(below.data.text);
        if (snap) reading = { ...reading, provinceCode: snap.code };
      }
    }
    return reading;
  });
}

/** Text spotting works best on a photo about this wide (bigger text reads worse). */
const SPOT_WIDTH = 1280;

export interface FoundPlate {
  /** The plate in photo pixels. */
  rect: Rect;
}

/** Width for close-ups, where text is too big for the normal width. */
const CLOSE_UP_WIDTH = 450;
/** Width for a last, detailed pass when a plate is small in the photo. */
const DETAIL_WIDTH = 2000;
/** Margin added around a detected plate face (its border and frame are left outside). */
const SUGGESTION_MARGIN = 0.04;

/**
 * Plates in a whole photo, in photo pixel coordinates, in reading order (D-072):
 *  1. the layout detector (lib/ocr/layout): plate paint regions seeded by text, which also
 *     splits photos of many plates laid out together; at a smaller scale for close-ups;
 *  2. if that finds nothing, the detector again at a larger scale (a small plate);
 *  3. only if that finds nothing either, OCR text spotting over the photo.
 */
export async function findPlates(photo: LoadedPhoto): Promise<FoundPlate[]> {
  // Let the "looking for plates" status paint before the synchronous pass runs.
  await new Promise((r) => setTimeout(r, 0));
  // Both scales: the small one sees whole plates in close-ups, where the big one may only see
  // half a plate. Overlapping boxes keep the bigger one (a whole plate beats part of it).
  const found = [
    ...(await verified(photo, layoutPass(photo, WORK_WIDTH))),
    ...(await verified(photo, layoutPass(photo, CLOSE_UP_WIDTH))),
  ];
  let rects = dedupe(found.map(toBox)).map(fromBox);
  // Nothing yet: maybe the plate is small in a big photo, too small at the normal width.
  if (rects.length === 0 && photo.width > WORK_WIDTH * 1.3) {
    rects = await verified(photo, layoutPass(photo, Math.min(photo.width, DETAIL_WIDTH)));
  }
  if (rects.length === 0) rects = await spotPlates(photo);
  return readingOrder(rects).map((rect) => ({ rect }));
}

const toBox = (r: Rect): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height });
const fromBox = (b: Box): Rect => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });

/** Suggestions whose reading is at least this sure (mean character probability) are kept. */
const SUGGESTION_MIN_SCORE = 0.6;

/**
 * Keep only suggestions that read as a plate (D-076): each box is cut out, its number line
 * found and read by the recognizer under the plate grammar. Windows, signs and lights don't
 * produce a confident plate reading. Without the model, every box is kept.
 */
async function verified(photo: LoadedPhoto, rects: Rect[]): Promise<Rect[]> {
  if (rects.length === 0) return rects;
  const model = await modelAt(MODEL_URL);
  if (!model) return rects;
  return rects.filter((r) => {
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(photo.canvas, r.x, r.y, r.width, r.height, 0, 0, w, h);
    const { canvas, lines } = cropLines(c, w, h);
    if (!lines) return false;
    const rec = recognizePlate(model, modelInput(canvas, lines.number, model));
    const mean = rec.probs.reduce((a, b) => a + b, 0) / Math.max(1, rec.probs.length);
    return rec.text.length >= 3 && mean >= SUGGESTION_MIN_SCORE;
  });
}

function layoutPass(photo: LoadedPhoto, width: number): Rect[] {
  const ctx = photo.canvas.getContext('2d', { willReadFrequently: true })!;
  const full = ctx.getImageData(0, 0, photo.width, photo.height);
  const small = downscale(full.data, photo.width, photo.height, width);
  const { width: w, height: h, scale } = small;
  return findPlatesInLayout(small.data, w, h).map((b) => {
    const mx = (b.x1 - b.x0) * SUGGESTION_MARGIN;
    const my = (b.y1 - b.y0) * SUGGESTION_MARGIN;
    const x0 = Math.max(0, b.x0 - mx) / scale;
    const y0 = Math.max(0, b.y0 - my) / scale;
    const x1 = Math.min(w, b.x1 + mx) / scale;
    const y1 = Math.min(h, b.y1 + my) / scale;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  });
}

/** Fallback: OCR text spotting over the whole photo. */
async function spotPlates(photo: LoadedPhoto): Promise<Rect[]> {
  const { canvas, scale } = prepare(photo.canvas, photo.width, photo.height, 0, SPOT_WIDTH);
  return exclusive(async (w) => {
    const T = await import('tesseract.js');
    await w.setParameters({
      tessedit_pageseg_mode: T.PSM.AUTO,
      tessedit_char_whitelist: '',
    });
    const result = await w.recognize(canvas, {}, { blocks: true });
    return findPlateRegions(wordLinesOf(result.data), canvas.width, canvas.height).map((r) => ({
      x: r.x0 / scale,
      y: r.y0 / scale,
      width: (r.x1 - r.x0) / scale,
      height: (r.y1 - r.y0) / scale,
    }));
  });
}

/** Top to bottom in rows, left to right within a row. */
function readingOrder(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y);
  const rows: Rect[][] = [];
  for (const r of sorted) {
    const row = rows[rows.length - 1];
    const last = row?.[0];
    if (last && r.y < last.y + last.height * 0.5) row.push(r);
    else rows.push([r]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
