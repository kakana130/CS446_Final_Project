import { isAsciiDigit } from './chars';
import { plateDisplay } from './canonical';
import { cleanChars } from './normalize';
import type { Plate, PlateInput, PlateType } from './types';

/**
 * What the plate-shaped input edits: the whole plate typed in one go, as people read it off
 * the plate ("กค7812", "1กข 1234", "70-1234"). It is split into parts here.
 */
export interface PlateDraft {
  type: PlateType;
  text: string;
  provinceCode: string | null;
}

export const EMPTY_DRAFT: PlateDraft = { type: 'car', text: '', provinceCode: null };

const isNumberChar = (c: string) => isAsciiDigit(c) || c === '?';

/**
 * Split typed plate text into the series (optional leading digit + letters) and the number.
 * The number is the trailing run of digits/`?`; spaces and dashes are optional.
 *  - "กค7812" → กค | 7812      - "1กข 1234" → 1กข | 1234
 *  - "ก?1234" → ก? | 1234     (a `?` that would make the number 5+ long belongs to the series)
 *  - "70-1234" on "other" → 70 | 1234 (bus/truck numeric series)
 */
export function splitPlateText(text: string, type: PlateType): { series: string; number: string } {
  const raw = text.normalize('NFC').trim();

  if (type === 'other') {
    const numeric = raw.match(/^([0-9๐-๙]{2,3})\s*[-–]\s*([0-9๐-๙?]{1,4})$/u);
    if (numeric) {
      return { series: cleanChars(numeric[1]).join(''), number: cleanChars(numeric[2]).join('') };
    }
  }

  const chars = cleanChars(raw);
  let cut = chars.length;
  while (cut > 0 && isNumberChar(chars[cut - 1]!)) cut--;
  const series = chars.slice(0, cut);
  const number = chars.slice(cut);

  while (number.length > 4 && number[0] === '?') series.push(number.shift()!);
  // A numeric series typed without the dash ("701234") on an "other" plate.
  if (type === 'other' && series.length === 0 && number.length > 4) {
    series.push(...number.splice(0, number.length - 4));
  }
  return { series: series.join(''), number: number.join('') };
}

export function draftToInput(draft: PlateDraft): PlateInput {
  const { series, number } = splitPlateText(draft.text, draft.type);
  const chars = [...series];
  const allDigits = chars.length > 0 && chars.every(isAsciiDigit);
  // "70" on an "other" plate is a numeric bus/truck series, not a leading digit.
  const hasPrefix =
    chars.length > 1 && isAsciiDigit(chars[0]!) && !(draft.type === 'other' && allDigits);
  return {
    type: draft.type,
    prefixDigit: hasPrefix ? chars[0]! : null,
    letters: (hasPrefix ? chars.slice(1) : chars).join(''),
    number,
    provinceCode: draft.provinceCode,
  };
}

export function plateToDraft(plate: Plate): PlateDraft {
  return { type: plate.type, text: plateDisplay(plate), provinceCode: plate.provinceCode };
}

/** Screen-reader friendly text: characters spaced so "กข" isn't read as a word. */
export function plateSpoken(plate: Plate, unknownChar: string): string {
  return [...plateDisplay(plate)]
    .map((c) => (c === '?' ? unknownChar : c))
    .join(' ')
    .replace(/\s{3,}/g, ', ');
}
