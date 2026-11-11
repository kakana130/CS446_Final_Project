/**
 * Plate-text recognizer runtime (D-074): a small CNN trained on the plate font (ml/recognizer)
 * that reads one number line, e.g. "1กข1234", with a confidence per character. Pure
 * TypeScript: the network is a fixed stack of convolutions, so no ML runtime is needed.
 *
 * Model file: "P2HR", uint32 header length, JSON header, float16 weights (see export.py).
 */

interface ConvOp {
  op: 'conv2d';
  shape: [number, number, number, number]; // out, in, kh, kw
  offset: number;
  pad: [number, number];
  w?: Float32Array;
  b?: Float32Array;
}
type Op = ConvOp | { op: 'relu' } | { op: 'maxpool'; k: [number, number] } | { op: 'squeeze_h' };

export interface RecognizerModel {
  height: number;
  width: number;
  /** Text models: characters after the CTC blank. */
  charset: string;
  ops: Op[];
}

export interface Recognition {
  text: string;
  /** Probability of each character, same order as `text`. */
  probs: number[];
  /** Lowest character probability (0 when nothing was read). */
  confidence: number;
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

export function loadRecognizer(buffer: ArrayBuffer): RecognizerModel {
  const bytes = new Uint8Array(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'P2HR') throw new Error('bad_model');
  const len = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + len)),
  ) as RecognizerModel;
  const start = 8 + len;
  const halves = new Uint16Array(buffer.slice(start, start + ((bytes.length - start) & ~1)));
  const read = (from: number, n: number) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = halfToFloat(halves[from + i]!);
    return out;
  };
  for (const op of header.ops) {
    if (op.op !== 'conv2d') continue;
    const [o, i, kh, kw] = op.shape;
    const n = o * i * kh * kw;
    op.w = read(op.offset, n);
    op.b = read(op.offset + n, o);
  }
  return header;
}

interface Tensor {
  data: Float32Array;
  c: number;
  h: number;
  w: number;
}

function conv2d(x: Tensor, op: ConvOp): Tensor {
  const [out, cin, kh, kw] = op.shape;
  const [ph, pw] = op.pad;
  const oh = x.h + 2 * ph - kh + 1;
  const ow = x.w + 2 * pw - kw + 1;
  const y = new Float32Array(out * oh * ow);
  const W = op.w!;
  const B = op.b!;
  for (let o = 0; o < out; o++) {
    const yo = o * oh * ow;
    y.fill(B[o]!, yo, yo + oh * ow);
    for (let i = 0; i < cin; i++) {
      const xi = i * x.h * x.w;
      for (let ky = 0; ky < kh; ky++) {
        for (let kx = 0; kx < kw; kx++) {
          const wv = W[((o * cin + i) * kh + ky) * kw + kx]!;
          if (wv === 0) continue;
          const ox0 = Math.max(0, pw - kx);
          const ox1 = Math.min(ow, x.w + pw - kx);
          const shift = kx - pw;
          for (let oy = 0; oy < oh; oy++) {
            const iy = oy + ky - ph;
            if (iy < 0 || iy >= x.h) continue;
            const rowIn = xi + iy * x.w + shift;
            const rowOut = yo + oy * ow;
            for (let ox = ox0; ox < ox1; ox++) y[rowOut + ox]! += wv * x.data[rowIn + ox]!;
          }
        }
      }
    }
  }
  return { data: y, c: out, h: oh, w: ow };
}

function maxpool(x: Tensor, kh: number, kw: number): Tensor {
  const oh = Math.floor(x.h / kh);
  const ow = Math.floor(x.w / kw);
  const y = new Float32Array(x.c * oh * ow);
  for (let c = 0; c < x.c; c++) {
    for (let oy = 0; oy < oh; oy++) {
      for (let ox = 0; ox < ow; ox++) {
        let m = -Infinity;
        for (let dy = 0; dy < kh; dy++) {
          for (let dx = 0; dx < kw; dx++) {
            const v = x.data[(c * x.h + oy * kh + dy) * x.w + ox * kw + dx]!;
            if (v > m) m = v;
          }
        }
        y[(c * oh + oy) * ow + ox] = m;
      }
    }
  }
  return { data: y, c: x.c, h: oh, w: ow };
}

/** Raw logits, classes × time steps (row-major), for an input of height × width in [0, 1]. */
export function logits(model: RecognizerModel, input: Float32Array): Tensor {
  let t: Tensor = { data: input, c: 1, h: model.height, w: model.width };
  for (const op of model.ops) {
    if (op.op === 'conv2d') t = conv2d(t, op);
    else if (op.op === 'relu') {
      for (let i = 0; i < t.data.length; i++) if (t.data[i]! < 0) t.data[i] = 0;
    } else if (op.op === 'maxpool') t = maxpool(t, op.k[0], op.k[1]);
    else t = { data: t.data, c: t.c, h: 1, w: t.h * t.w }; // height is 1 already
  }
  return t;
}

/** Greedy CTC decoding with per-character probabilities. */
export function recognize(model: RecognizerModel, input: Float32Array): Recognition {
  const out = logits(model, input);
  const C = out.c;
  const T = out.w;
  let text = '';
  const probs: number[] = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let max = -Infinity;
    for (let c = 0; c < C; c++) {
      const v = out.data[c * T + t]!;
      if (v > max) {
        max = v;
        best = c;
      }
    }
    let sum = 0;
    for (let c = 0; c < C; c++) sum += Math.exp(out.data[c * T + t]! - max);
    const p = 1 / sum;
    if (best !== 0 && best === prev) {
      probs[probs.length - 1] = Math.max(probs[probs.length - 1]!, p);
    } else if (best !== 0) {
      text += model.charset[best - 1];
      probs.push(p);
    }
    prev = best;
  }
  return { text, probs, confidence: probs.length ? Math.min(...probs) : 0 };
}

/**
 * Model input from a grey line image already scaled to the model height (width ≤ model
 * width): padded with its median grey, then contrast-stretched between the 2nd and 98th
 * percentiles, exactly like training (synth.to_input).
 */
export function toInput(grey: ArrayLike<number>, w: number, model: RecognizerModel): Float32Array {
  const H = model.height;
  const W = model.width;
  const sorted = Array.from(grey).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1] ?? 128;
  const out = new Float32Array(H * W).fill(median / 255);
  const cw = Math.min(w, W);
  for (let y = 0; y < H; y++) for (let x = 0; x < cw; x++) out[y * W + x] = grey[y * w + x]! / 255;
  const all = Array.from(out).sort((a, b) => a - b);
  const pct = (q: number) => {
    const pos = (all.length - 1) * q;
    const lo = Math.floor(pos);
    return all[lo]! + (all[Math.min(all.length - 1, lo + 1)]! - all[lo]!) * (pos - lo);
  };
  const lo = pct(0.02);
  const hi = pct(0.98);
  const range = Math.max(1e-3, hi - lo);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i]! - lo) / range));
  return out;
}

// ------------------------------------------------------------ plate-grammar constrained decoding

const DIGIT = /[0-9]/;

/**
 * Grammar of a car plate number line: optional leading digit 1–9, one or two consonants, then
 * a number of 1–4 digits not starting with 0. States: 0 start, 1 after the leading digit,
 * 2/3 one/two letters, 4..7 one..four digits (accepting).
 */
function nextState(state: number, ch: string): number {
  const digit = DIGIT.test(ch);
  switch (state) {
    case 0:
      return digit ? (ch === '0' ? -1 : 1) : 2;
    case 1:
      return digit ? -1 : 2;
    case 2:
      return digit ? (ch === '0' ? -1 : 4) : 3;
    case 3:
      return digit ? (ch === '0' ? -1 : 4) : -1;
    default:
      return digit && state < 7 ? state + 1 : -1;
  }
}

/**
 * The most probable reading that is a valid plate number line (Viterbi over the CTC outputs
 * and the plate grammar). Where the network hesitated, the grammar picks the valid option;
 * that character keeps its own (low) probability, so it can still be flagged as unsure.
 */
export function recognizePlate(model: RecognizerModel, input: Float32Array): Recognition {
  const out = logits(model, input);
  return decodePlate(out.data, out.c, out.w, model.charset);
}

export function decodePlate(
  raw: ArrayLike<number>,
  C: number,
  T: number,
  charset: string,
): Recognition {
  // Log-probabilities per frame.
  const lp = new Float64Array(C * T);
  for (let t = 0; t < T; t++) {
    let max = -Infinity;
    for (let c = 0; c < C; c++) max = Math.max(max, raw[c * T + t]!);
    let sum = 0;
    for (let c = 0; c < C; c++) sum += Math.exp(raw[c * T + t]! - max);
    const lse = max + Math.log(sum);
    for (let c = 0; c < C; c++) lp[c * T + t] = raw[c * T + t]! - lse;
  }
  const G = 8;
  const S = G * C; // (grammar state, last symbol) with last symbol 0 = blank
  const NEG = -Infinity;
  let score = new Float64Array(S).fill(NEG);
  score[0] = 0; // start state, last = blank
  const back = new Int32Array(S * T).fill(-1);
  for (let t = 0; t < T; t++) {
    const next = new Float64Array(S).fill(NEG);
    for (let s = 0; s < S; s++) {
      const base = score[s]!;
      if (base === NEG) continue;
      const g = Math.floor(s / C);
      const last = s % C;
      // Blank.
      const b = g * C;
      const vb = base + lp[t]!;
      if (vb > next[b]!) {
        next[b] = vb;
        back[b * T + t] = s;
      }
      // Repeat of the last symbol (no new character).
      if (last !== 0) {
        const vr = base + lp[last * T + t]!;
        if (vr > next[s]!) {
          next[s] = vr;
          back[s * T + t] = s;
        }
      }
      // A new character.
      for (let c = 1; c < C; c++) {
        if (c === last) continue;
        const g2 = nextState(g, charset[c - 1]!);
        if (g2 < 0) continue;
        const s2 = g2 * C + c;
        const v = base + lp[c * T + t]!;
        if (v > next[s2]!) {
          next[s2] = v;
          back[s2 * T + t] = s;
        }
      }
    }
    score = next;
  }
  let best = -1;
  for (let s = 4 * C; s < S; s++) if (best < 0 || score[s]! > score[best]!) best = s;
  if (best < 0 || score[best] === NEG) return { text: '', probs: [], confidence: 0 };

  // Walk back: a new character starts where the grammar state or the symbol changed.
  const path = new Int32Array(T);
  let s = best;
  for (let t = T - 1; t >= 0; t--) {
    path[t] = s;
    s = back[s * T + t]!;
  }
  let text = '';
  const probs: number[] = [];
  let prev = 0; // state before frame 0: start, blank
  for (let t = 0; t < T; t++) {
    const cur = path[t]!;
    const sym = cur % C;
    const isNew = sym !== 0 && (Math.floor(cur / C) !== Math.floor(prev / C) || prev % C !== sym);
    const p = sym !== 0 ? Math.exp(lp[sym * T + t]!) : 0;
    if (isNew) {
      text += charset[sym - 1];
      probs.push(p);
    } else if (sym !== 0 && probs.length) {
      probs[probs.length - 1] = Math.max(probs[probs.length - 1]!, p);
    }
    prev = cur;
  }
  return { text, probs, confidence: probs.length ? Math.min(...probs) : 0 };
}

/**
 * Resize grey pixels the way Pillow's BILINEAR filter does (a triangle filter widened when
 * shrinking), so browser input matches the training data exactly.
 */
export function resizeBilinear(
  src: ArrayLike<number>,
  w: number,
  h: number,
  nw: number,
  nh: number,
): Float32Array {
  const coeffs = (inSize: number, outSize: number) => {
    const scale = inSize / outSize;
    const fscale = Math.max(scale, 1);
    const support = fscale;
    const rows: { start: number; weights: number[] }[] = [];
    for (let x = 0; x < outSize; x++) {
      const center = (x + 0.5) * scale;
      const start = Math.max(0, Math.floor(center - support + 0.5));
      const end = Math.min(inSize, Math.floor(center + support + 0.5));
      const weights: number[] = [];
      let total = 0;
      for (let i = start; i < end; i++) {
        const v = Math.max(0, 1 - Math.abs((i - center + 0.5) / fscale));
        weights.push(v);
        total += v;
      }
      rows.push({ start, weights: weights.map((v) => (total ? v / total : 0)) });
    }
    return rows;
  };
  const cx = coeffs(w, nw);
  const cy = coeffs(h, nh);
  const tmp = new Float32Array(nw * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < nw; x++) {
      const { start, weights } = cx[x]!;
      let v = 0;
      for (let k = 0; k < weights.length; k++) v += weights[k]! * src[y * w + start + k]!;
      tmp[y * nw + x] = v;
    }
  }
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const { start, weights } = cy[y]!;
    for (let x = 0; x < nw; x++) {
      let v = 0;
      for (let k = 0; k < weights.length; k++) v += weights[k]! * tmp[(start + k) * nw + x]!;
      out[y * nw + x] = Math.round(Math.min(255, Math.max(0, v)));
    }
  }
  return out;
}
