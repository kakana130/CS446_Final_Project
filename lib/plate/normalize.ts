import {
  isAsciiDigit,
  isLatinUpper,
  isPlateConsonant,
  isThaiNonConsonant,
  thaiDigitToAscii,
} from './chars';
import { WILDCARD, type Plate, type PlateInput, type PlateType } from './types';

/** Characters people (and OCR) use for "can't read this one". All become `?`. */
const WILDCARD_ALIASES = new Set(['?', '？', '*', '＊', '_', '•']);

/** Separators users type between groups: dropped. */
const SEPARATORS = /[\s\-‐‑–—.,·:/\\|'"]/u;

/**
 * Split raw text into plate-relevant characters: NFC, Thai digits → Arabic, wildcard aliases
 * → `?`, Latin upper-cased, separators and Thai vowels/tone marks removed.
 */
export function cleanChars(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const original of raw.normalize('NFC')) {
    if (SEPARATORS.test(original)) continue;
    if (WILDCARD_ALIASES.has(original)) {
      out.push(WILDCARD);
      continue;
    }
    const ch = thaiDigitToAscii(original).toUpperCase();
    if (isThaiNonConsonant(ch)) continue;
    out.push(ch);
  }
  return out;
}

function keep(chars: string[], allow: (ch: string) => boolean): string {
  return chars.filter((c) => c === WILDCARD || allow(c)).join('');
}

/**
 * Series letters. Car and motorcycle series are Thai consonants only; `other` plates may carry
 * a numeric series (trucks: `70-1234`) or Latin letters (test plates), so those are kept.
 */
export function normalizeLetters(raw: string | null | undefined, type: PlateType): string {
  const chars = cleanChars(raw);
  if (type === 'other') {
    return keep(chars, (c) => isPlateConsonant(c) || isAsciiDigit(c) || isLatinUpper(c));
  }
  return keep(chars, isPlateConsonant);
}

/** Registration number: digits and wildcards; leading zeros are dropped (plates never show them). */
export function normalizeNumber(raw: string | null | undefined): string {
  const digits = keep(cleanChars(raw), isAsciiDigit);
  const stripped = digits.replace(/^0+(?=.)/, '');
  return stripped;
}

/** The single leading digit of `1กข 1234`, or null. */
export function normalizePrefix(raw: string | null | undefined): string | null {
  const chars = cleanChars(raw).filter((c) => c === WILDCARD || isAsciiDigit(c));
  return chars[0] ?? null;
}

export function normalizeProvinceCode(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase();
  return code ? code : null;
}

export function normalizePlate(input: PlateInput): Plate {
  return {
    type: input.type,
    prefixDigit: normalizePrefix(input.prefixDigit),
    letters: normalizeLetters(input.letters, input.type),
    number: normalizeNumber(input.number),
    provinceCode: normalizeProvinceCode(input.provinceCode),
  };
}

export function hasWildcards(plate: Plate): boolean {
  return [plate.prefixDigit ?? '', plate.letters, plate.number].some((s) => s.includes(WILDCARD));
}
