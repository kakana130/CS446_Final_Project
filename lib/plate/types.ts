export const PLATE_TYPES = ['car', 'motorcycle', 'other'] as const;
export type PlateType = (typeof PLATE_TYPES)[number];

/** `?` stands for exactly one unreadable character. */
export const WILDCARD = '?';

/** Raw user or OCR input, before normalization. */
export interface PlateInput {
  type: PlateType;
  prefixDigit?: string | null;
  letters?: string | null;
  number?: string | null;
  provinceCode?: string | null;
}

/** Normalized plate: NFC, no whitespace, Arabic digits, only characters a plate can carry. */
export interface Plate {
  type: PlateType;
  /** Single digit (or `?`) in front of the letters, e.g. the `1` in `1กข 1234`. */
  prefixDigit: string | null;
  /** Series letters. For `other` plates this may also be a numeric series such as `70`. */
  letters: string;
  number: string;
  /** Province code (ISO 3166-2:TH or TH-BTG), or null when unknown. */
  provinceCode: string | null;
}

export type FormatStatus = 'valid' | 'unverified';

export type ValidationIssue =
  | 'letters_missing'
  | 'letters_length'
  | 'letters_charset'
  | 'number_missing'
  | 'number_length'
  | 'number_zero'
  | 'prefix_not_allowed'
  | 'prefix_required'
  | 'province_unknown_code'
  | 'no_matching_format';

export interface ValidationResult {
  status: FormatStatus;
  /** The format rule that matched, if any (see formats.config.ts). */
  formatId: string | null;
  issues: ValidationIssue[];
}
