import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePlate, loadRecognizer, logits, recognize, toInput } from './recognizer';

// The shipped model and a test vector exported alongside it (ml/recognizer/export.py).
const root = join(__dirname, '..', '..');
const bin = readFileSync(join(root, 'public', 'models', 'plate-rec.bin'));
const vector = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'recognizer-vector.json'), 'utf8'),
) as { cases: { text: string; input: string; argmax: number[]; decoded: string }[] };
const model = loadRecognizer(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

// Full model passes are slow under coverage instrumentation on CI machines.
describe('plate-text recognizer runtime', { timeout: 120_000 }, () => {
  it('loads the model header', () => {
    expect(model.height).toBe(48);
    expect(model.width).toBe(192);
    expect(model.charset).toHaveLength(52);
  });

  it('matches PyTorch on the exported test vector', () => {
    for (const c of vector.cases) {
      const q = Buffer.from(c.input, 'base64');
      const x = Float32Array.from(q, (v) => v / 255);
      const out = logits(model, x);
      const argmax: number[] = [];
      for (let t = 0; t < out.w; t++) {
        let best = 0;
        for (let k = 1; k < out.c; k++) {
          if (out.data[k * out.w + t]! > out.data[best * out.w + t]!) best = k;
        }
        argmax.push(best);
      }
      // float16 weights: allow a rare disagreement on a near-tie frame.
      const same = argmax.filter((v, i) => v === c.argmax[i]).length;
      expect(same / argmax.length).toBeGreaterThan(0.95);
      expect(recognize(model, x).text).toBe(c.decoded);
    }
  });

  it('reports a probability per character', () => {
    const c = vector.cases[0]!;
    const x = Float32Array.from(Buffer.from(c.input, 'base64'), (v) => v / 255);
    const r = recognize(model, x);
    expect(r.probs).toHaveLength(r.text.length);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

describe('toInput', () => {
  it('pads to the model width and stretches contrast to 0..1', () => {
    const w = 100;
    const grey = new Uint8Array(w * 48).fill(200);
    for (let i = 0; i < grey.length; i += 7) grey[i] = 40;
    const x = toInput(grey, w, model);
    expect(x).toHaveLength(48 * 192);
    expect(Math.min(...x)).toBe(0);
    expect(Math.max(...x)).toBe(1);
  });
});

describe('decodePlate (plate-grammar decoding)', () => {
  const charset = '0123456789กข';
  const C = charset.length + 1;
  /** Frames of class probabilities → logits laid out classes × frames. */
  const frames = (ps: Record<string, number>[]) => {
    const T = ps.length;
    const out = new Float32Array(C * T).fill(Math.log(1e-4));
    ps.forEach((p, t) => {
      for (const [ch, v] of Object.entries(p)) {
        const c = ch === '_' ? 0 : charset.indexOf(ch) + 1;
        out[c * T + t] = Math.log(v);
      }
    });
    return { out, T };
  };

  it('picks the valid reading where the network hesitated', () => {
    // Greedy would read "772" (not a plate); the grammar forces a letter after the first digit.
    const { out, T } = frames([
      { '7': 0.9 },
      { _: 0.9 },
      { '7': 0.6, ก: 0.4 },
      { _: 0.9 },
      { '2': 0.9 },
    ]);
    const r = decodePlate(out, C, T, charset);
    expect(r.text).toBe('7ก2');
    expect(r.probs[1]).toBeCloseTo(0.4, 1); // the forced letter stays marked as unsure
  });

  it('allows at most four digits in the number', () => {
    const { out, T } = frames([
      { ก: 0.9 },
      { _: 0.9 },
      ...['1', '2', '3', '4', '5'].flatMap((d) => [
        { [d]: d === '5' ? 0.55 : 0.9, _: 0.45 },
        { _: 0.9 },
      ]),
    ]);
    expect(decodePlate(out, C, T, charset).text).toBe('ก1234');
  });

  it('keeps repeated characters separated by a blank', () => {
    const { out, T } = frames([
      { ข: 0.9 },
      { _: 0.9 },
      { ข: 0.9 },
      { '2': 0.9 },
      { _: 0.9 },
      { '2': 0.9 },
    ]);
    expect(decodePlate(out, C, T, charset).text).toBe('ขข22');
  });
});
