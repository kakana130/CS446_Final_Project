/**
 * Thai character classes relevant to licence plates.
 *
 * Series letters use Thai consonants only. The obsolete ฃ and ฅ are never issued, and
 * ฤ/ฦ are vowels despite sitting in the consonant block, so all four are excluded.
 */

const CONSONANT_FIRST = 0x0e01; // ก
const CONSONANT_LAST = 0x0e2e; // ฮ
const EXCLUDED = new Set(['ฃ', 'ฅ', 'ฤ', 'ฦ']);

export const PLATE_CONSONANTS: readonly string[] = Array.from(
  { length: CONSONANT_LAST - CONSONANT_FIRST + 1 },
  (_, i) => String.fromCodePoint(CONSONANT_FIRST + i),
).filter((c) => !EXCLUDED.has(c));

const consonantSet = new Set(PLATE_CONSONANTS);

export function isPlateConsonant(ch: string): boolean {
  return consonantSet.has(ch);
}

export function isAsciiDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function isLatinUpper(ch: string): boolean {
  return ch >= 'A' && ch <= 'Z';
}

/** Thai digits ๐–๙ → 0–9. */
export function thaiDigitToAscii(ch: string): string {
  const cp = ch.codePointAt(0)!;
  return cp >= 0x0e50 && cp <= 0x0e59 ? String(cp - 0x0e50) : ch;
}

/**
 * Thai vowels, tone marks and signs never appear on a plate. Users on Thai keyboards type
 * them by accident (e.g. "กา"), so normalization drops them.
 */
export function isThaiNonConsonant(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return (
    (cp >= 0x0e2f && cp <= 0x0e4f) || // ฯ ะ ั า ำ ิ ... ๏ (vowels, tone marks, signs)
    (cp >= 0x0e5a && cp <= 0x0e5b) || // ๚ ๛
    ch === 'ฤ' ||
    ch === 'ฦ'
  );
}
