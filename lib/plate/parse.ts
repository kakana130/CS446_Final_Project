import { cleanChars } from './normalize';
import { snapProvince } from './provinces';
import type { PlateInput, PlateType } from './types';

/**
 * Parse free text such as `1กข 1234 กรุงเทพมหานคร`, `กขค-123`, or `70-1234` into plate parts.
 * Used for OCR output and pasted text; the plate-shaped input component produces parts
 * directly. Returns null when the text doesn't look like a plate at all.
 */
export function parsePlateText(text: string, type?: PlateType): PlateInput | null {
  const raw = text.normalize('NFC').trim();
  if (!raw) return null;

  // Split off a trailing province name: everything after the last digit or wildcard.
  const lastNumberChar = Math.max(raw.search(/[0-9๐-๙?？][^0-9๐-๙?？]*$/u), -1);
  const head = lastNumberChar >= 0 ? raw.slice(0, lastNumberChar + 1) : raw;
  const tail = lastNumberChar >= 0 ? raw.slice(lastNumberChar + 1).trim() : '';
  const province = /[ก-ฮa-zA-Z]{2,}/u.test(tail) ? snapProvince(tail) : null;
  const provinceCode = province?.code ?? null;

  // Bus/truck numeric series: 70-1234, 701-2345 (the separator matters here).
  const numeric = head.match(/^([0-9๐-๙]{2,3})\s*[-–]\s*([0-9๐-๙?]{1,4})$/u);
  if (numeric && (type === undefined || type === 'other')) {
    return {
      type: 'other',
      prefixDigit: null,
      letters: cleanChars(numeric[1]).join(''),
      number: numeric[2]!,
      provinceCode,
    };
  }

  const compact = cleanChars(head).join('');
  const m = compact.match(/^([0-9?])?([ก-ฮ?]{1,3})([0-9?]{1,4})$/u);
  if (!m) return null;
  const [, prefix, letters, number] = m;
  const inferred: PlateType = type ?? ([...letters!].length === 3 ? 'motorcycle' : 'car');

  return {
    type: inferred,
    prefixDigit: prefix ?? null,
    letters: letters!,
    number: number!,
    provinceCode,
  };
}
