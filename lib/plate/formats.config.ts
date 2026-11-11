import type { PlateType } from './types';

/**
 * Thai licence plate formats as data. Sources and history: docs/plate-formats.md.
 * A plate is `valid` when it satisfies at least one rule for its type; otherwise it is saved
 * as `unverified` (never rejected). `?` satisfies any character class.
 */

export type LetterCharset = 'consonant' | 'consonant-or-latin' | 'digit';

export interface FormatRule {
  id: string;
  type: PlateType;
  /** Leading digit before the letters (`1` in `1กข 1234`). */
  prefix: 'none' | 'optional' | 'required';
  letters: { min: number; max: number; charset: LetterCharset };
  number: { maxDigits: number };
  note: string;
}

export const FORMAT_RULES: readonly FormatRule[] = [
  {
    id: 'car-series',
    type: 'car',
    prefix: 'optional',
    letters: { min: 1, max: 2, charset: 'consonant' },
    number: { maxDigits: 4 },
    note: 'กข 1234, 1กข 1234 (leading digit since 2012 in Bangkok), legacy single-letter series',
  },
  {
    id: 'motorcycle-legacy',
    type: 'motorcycle',
    prefix: 'none',
    letters: { min: 3, max: 3, charset: 'consonant' },
    number: { maxDigits: 3 },
    note: 'Top line three consonants (กขค), province, number 1–999',
  },
  {
    id: 'motorcycle-digit-series',
    type: 'motorcycle',
    prefix: 'required',
    letters: { min: 2, max: 2, charset: 'consonant' },
    number: { maxDigits: 4 },
    note: 'Top line digit + two consonants (1กข), province, number 1–9999 (DLT format from 2012)',
  },
  {
    id: 'other-series',
    type: 'other',
    prefix: 'optional',
    letters: { min: 0, max: 3, charset: 'consonant-or-latin' },
    number: { maxDigits: 4 },
    note: 'Taxi, commercial, temporary red plates, test plates: relaxed',
  },
  {
    id: 'other-numeric-series',
    type: 'other',
    prefix: 'none',
    letters: { min: 2, max: 3, charset: 'digit' },
    number: { maxDigits: 4 },
    note: 'Buses and trucks: 10-1234, 70-1234, 701-2345 (Bangkok 700+ series since 2024)',
  },
];

export function rulesFor(type: PlateType): FormatRule[] {
  return FORMAT_RULES.filter((r) => r.type === type);
}
