import { describe, expect, it } from 'vitest';
import {
  findPlateRegions,
  growPlateBox,
  interpretPlateLines,
  maskUnsure,
  type OcrLine,
  type OcrWord,
} from './interpret';

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const line = (text: string, confidence = 90, bbox = box(0, 0, 100, 40)): OcrLine => ({
  text,
  confidence,
  bbox,
});

describe('interpretPlateLines', () => {
  it('reads a car plate: number line + province line', () => {
    expect(interpretPlateLines([line('กท 2058', 88), line('ฉะเชิงเทรา', 80)], 'car')).toMatchObject(
      { text: 'กท 2058', provinceCode: 'TH-24', confidence: 0.88 },
    );
  });

  it('keeps a leading digit and ignores noise and vowels', () => {
    expect(interpretPlateLines([line('| 1กข 1234 .'), line('กรุงเทพมหานคร')], 'car')).toMatchObject(
      {
        text: '1กข 1234',
        provinceCode: 'TH-10',
      },
    );
  });

  it('reads a three-line motorcycle plate', () => {
    expect(
      interpretPlateLines([line('1กข', 80), line('เชียงใหม่', 85), line('123', 90)], 'motorcycle'),
    ).toMatchObject({ text: '1กข 123', provinceCode: 'TH-50', confidence: 0.8 });
  });

  it('leaves the province unknown when no line looks like one', () => {
    expect(interpretPlateLines([line('กข 99'), line('xxxxxxx')], 'car')?.provinceCode).toBeNull();
  });

  it('drops border noise read as extra digits, with lower confidence', () => {
    const r = interpretPlateLines([line('กท 205868', 80), line('ฉะเชิงเทรา')], 'car');
    expect(r).toMatchObject({ text: 'กท 2058', provinceCode: 'TH-24' });
    expect(r!.confidence).toBeCloseTo(0.56);
  });

  it('ignores plate borders read as stray letters at the edges', () => {
    expect(interpretPlateLines([line('ป กท 2058 ป'), line('ฉะเชิงเทรา')], 'car')?.text).toBe(
      'กท 2058',
    );
  });

  it('returns null when nothing looks like a plate', () => {
    expect(interpretPlateLines([line('สวัสดีครับ'), line('')], 'car')).toBeNull();
  });

  it('turns characters read with very low confidence into ?', () => {
    const l: OcrLine = {
      ...line('กข 1234'),
      symbols: [
        { text: 'ก', confidence: 90 },
        { text: 'ข', confidence: 20 },
        { text: '1', confidence: 90 },
        { text: '2', confidence: 90 },
        { text: '3', confidence: 10 },
        { text: '4', confidence: 90 },
      ],
    };
    expect(interpretPlateLines([l], 'car')?.text).toBe('ก? 12?4');
  });
});

describe('maskUnsure', () => {
  it('returns the text unchanged without symbol data', () => {
    expect(maskUnsure('กข 1234', undefined)).toBe('กข 1234');
  });
});

describe('findPlateRegions', () => {
  const word = (text: string, bbox: ReturnType<typeof box>): OcrWord => ({
    text,
    confidence: 80,
    bbox,
  });

  it('groups per-letter "words" on a line into a plate (how Tesseract returns Thai)', () => {
    // Real output shape for "กท 2058 / ฉะเชิงเทรา": letters come back as separate words.
    const regions = findPlateRegions(
      [
        {
          words: [
            word('ก', box(153, 197, 205, 264)),
            word('ท', box(225, 170, 288, 293)),
            word('2058', box(358, 175, 651, 266)),
          ],
        },
        { words: [word('ฉะ', box(277, 315, 331, 345)), word('เชิงเทรา', box(337, 298, 522, 359))] },
      ],
      1280,
      960,
    );
    expect(regions).toHaveLength(1);
    const r = regions[0]!;
    expect(r.x0).toBeLessThan(153);
    expect(r.x1).toBeGreaterThan(651);
    expect(r.y1).toBeGreaterThan(345); // covers the province line
  });

  it('tolerates a plate border read as extra digits ("205868")', () => {
    const regions = findPlateRegions(
      [
        {
          words: [
            word('ก', box(163, 196, 230, 264)),
            word('ท', box(243, 196, 309, 264)),
            word('205868', box(361, 179, 638, 265)),
          ],
        },
      ],
      1280,
      960,
    );
    expect(regions).toHaveLength(1);
  });

  it('measures the plate from its characters, not from border "letters" at the edges', () => {
    const regions = findPlateRegions(
      [
        {
          words: [
            word('ป', box(100, 100, 130, 400)), // left border, as tall as the plate
            word('กท', box(160, 180, 300, 260)),
            word('2058', box(340, 180, 620, 260)),
            word('ป', box(650, 100, 680, 400)), // right border
          ],
        },
      ],
      1280,
      960,
    );
    expect(regions).toHaveLength(1);
    // Top follows the text (180, less a margin), not the border (100).
    expect(regions[0]!.y0).toBeGreaterThan(110);
  });

  it('finds a plate read as a single word, and merges duplicates', () => {
    const regions = findPlateRegions(
      [
        { words: [word('1กข1234', box(50, 50, 250, 90))] },
        { words: [word('1กข', box(50, 50, 130, 90)), word('1234', box(140, 50, 250, 90))] },
      ],
      800,
      600,
    );
    expect(regions).toHaveLength(1);
  });

  it('splits two plates side by side on the same text line', () => {
    const regions = findPlateRegions(
      [
        {
          words: [
            word('กข', box(0, 100, 80, 140)),
            word('12', box(100, 100, 160, 140)),
            word('ขค', box(600, 100, 680, 140)),
            word('55', box(700, 100, 760, 140)),
          ],
        },
      ],
      1280,
      960,
    );
    expect(regions).toHaveLength(2);
  });

  it('ignores text that is not a plate, and letters far from a number', () => {
    expect(
      findPlateRegions(
        [
          { words: [word('ป้าย', box(0, 0, 60, 30)), word('ทะเบียน', box(70, 0, 160, 30))] },
          { words: [word('กข', box(0, 200, 60, 230)), word('1234', box(500, 200, 600, 230))] },
        ],
        800,
        600,
      ),
    ).toEqual([]);
  });
});

describe('growPlateBox', () => {
  it('adds margins and the province line, clamped to the image', () => {
    expect(growPlateBox({ x0: 10, y0: 100, x1: 300, y1: 140 }, 320, 200)).toEqual({
      x0: 0,
      y0: 72,
      x1: 320,
      y1: 200,
    });
  });
});
