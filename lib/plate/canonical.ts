import { foldConfusables } from './confusables.config';
import { clampToLimits } from './limits';
import { hasWildcards, normalizePlate } from './normalize';
import type { Plate, PlateInput, ValidationResult } from './types';
import { validatePlate } from './validate';

/** `type|prefix|letters|number|province`, e.g. `car|1|กข|1234|TH-10`. Unknown parts are empty. */
export function canonical(plate: Plate): string {
  return [
    plate.type,
    plate.prefixDigit ?? '',
    plate.letters,
    plate.number,
    plate.provinceCode ?? '',
  ].join('|');
}

/** Confusable-folded `prefix+letters+number` used for trigram candidate retrieval. */
export function plateKey(plate: Plate): string {
  return foldConfusables(`${plate.prefixDigit ?? ''}${plate.letters}${plate.number}`);
}

const isNumericSeries = (letters: string) => /^[0-9?]+$/.test(letters) && letters.length > 0;

/** Human-readable plate without the province: `1กข 1234`, `กขค 123`, `70-1234`. */
export function plateDisplay(plate: Plate): string {
  if (plate.type === 'other' && isNumericSeries(plate.letters) && plate.prefixDigit === null) {
    return `${plate.letters}-${plate.number}`;
  }
  const series = `${plate.prefixDigit ?? ''}${plate.letters}`;
  return series ? `${series} ${plate.number}` : plate.number;
}

export interface PlateRecord {
  plate: Plate;
  canonical: string;
  key: string;
  display: string;
  hasWildcards: boolean;
  validation: ValidationResult;
}

/**
 * Everything the server stores for a plate, derived in one place from raw input. Parts are
 * clamped to the storable limits, so the result always fits the database.
 */
export function buildPlateRecord(input: PlateInput): PlateRecord {
  const plate = clampToLimits(normalizePlate(input));
  return {
    plate,
    canonical: canonical(plate),
    key: plateKey(plate),
    display: plateDisplay(plate),
    hasWildcards: hasWildcards(plate),
    validation: validatePlate(plate),
  };
}
