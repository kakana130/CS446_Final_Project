import data from '@/data/provinces.json';
import { similarity } from './distance';

export interface Province {
  code: string;
  name_th: string;
  name_en: string;
  aliases: string[];
}

/** 77 provinces (ISO 3166-2:TH) plus Betong, in DLT/ISO code order. Single source: data/provinces.json. */
export const PROVINCES: readonly Province[] = data;

const byCode = new Map(PROVINCES.map((p) => [p.code, p]));

export function provinceByCode(code: string | null | undefined): Province | undefined {
  return code ? byCode.get(code) : undefined;
}

export function isKnownProvince(code: string): boolean {
  return byCode.has(code);
}

export function provinceName(code: string | null | undefined, locale: 'th' | 'en'): string | null {
  const p = provinceByCode(code);
  if (!p) return null;
  return locale === 'th' ? p.name_th : p.name_en;
}

/** Lower-case, NFC, no whitespace or dots, without a leading "จังหวัด"/"จ." marker. */
function normalizeName(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/^(จังหวัด|จ\.)\s*/u, '')
    .replace(/\s*province$/, '')
    .replace(/[\s.]/g, '');
}

const index = PROVINCES.map((p) => ({
  province: p,
  names: [p.name_th, p.name_en, ...p.aliases].map(normalizeName),
}));

/**
 * Province picker search: matches Thai, English and aliases. Prefix matches rank before
 * substring matches; ties keep the canonical order. An empty query returns everything.
 */
export function searchProvinces(query: string, limit = PROVINCES.length): Province[] {
  const q = normalizeName(query);
  if (!q) return PROVINCES.slice(0, limit);
  const scored: { p: Province; rank: number; order: number }[] = [];
  index.forEach(({ province, names }, order) => {
    if (names.some((n) => n.startsWith(q))) scored.push({ p: province, rank: 0, order });
    else if (names.some((n) => n.includes(q))) scored.push({ p: province, rank: 1, order });
  });
  return scored
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.p);
}

export interface ProvinceSnap {
  code: string;
  /** Similarity of the best match, 0..1. */
  confidence: number;
}

/**
 * Snap noisy recognized text (OCR / Tesseract) to the nearest province name. Returns null
 * when nothing is close enough, or when the two best provinces are too close to call.
 */
export function snapProvince(
  text: string,
  minConfidence = 0.6,
  minMargin = 0.08,
): ProvinceSnap | null {
  const q = normalizeName(text);
  if (!q) return null;
  const ranked = index
    .map(({ province, names }) => ({
      code: province.code,
      score: Math.max(...names.map((n) => similarity(q, n))),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = ranked;
  if (!best || best.score < minConfidence) return null;
  if (best.score < 1 && second && best.score - second.score < minMargin) return null;
  return { code: best.code, confidence: best.score };
}
