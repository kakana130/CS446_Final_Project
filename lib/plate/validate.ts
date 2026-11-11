import { isAsciiDigit, isLatinUpper, isPlateConsonant } from './chars';
import { rulesFor, type FormatRule, type LetterCharset } from './formats.config';
import { isKnownProvince } from './provinces';
import { WILDCARD, type Plate, type ValidationIssue, type ValidationResult } from './types';

const CHARSET_TEST: Record<LetterCharset, (ch: string) => boolean> = {
  consonant: isPlateConsonant,
  'consonant-or-latin': (ch) => isPlateConsonant(ch) || isLatinUpper(ch),
  digit: isAsciiDigit,
};

function checkRule(plate: Plate, rule: FormatRule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (rule.prefix === 'none' && plate.prefixDigit !== null) issues.push('prefix_not_allowed');
  if (rule.prefix === 'required' && plate.prefixDigit === null) issues.push('prefix_required');

  const letters = [...plate.letters];
  if (letters.length === 0 && rule.letters.min > 0) {
    issues.push('letters_missing');
  } else if (letters.length < rule.letters.min || letters.length > rule.letters.max) {
    issues.push('letters_length');
  }
  const allowed = CHARSET_TEST[rule.letters.charset];
  if (letters.some((c) => c !== WILDCARD && !allowed(c))) issues.push('letters_charset');

  if (plate.number.length === 0) issues.push('number_missing');
  else if (plate.number.length > rule.number.maxDigits) issues.push('number_length');
  else if (plate.number === '0') issues.push('number_zero');

  return issues;
}

/**
 * When no rule matches, the closest rule explains what looks wrong. A missing or extra
 * leading digit is a smaller deviation than a wrong letter count or charset.
 */
const ISSUE_WEIGHT = (issue: ValidationIssue) =>
  issue === 'prefix_required' || issue === 'prefix_not_allowed' ? 1 : 2;

/**
 * Checks a normalized plate against the configured formats for its type. Never throws and
 * never blocks saving: a plate that fits no rule is `unverified` and carries the issues of the
 * closest rule so the UI can explain what looks wrong.
 */
export function validatePlate(plate: Plate): ValidationResult {
  const provinceIssues: ValidationIssue[] =
    plate.provinceCode !== null && !isKnownProvince(plate.provinceCode)
      ? ['province_unknown_code']
      : [];

  let best: { rule: FormatRule; issues: ValidationIssue[]; weight: number } | null = null;
  for (const rule of rulesFor(plate.type)) {
    const issues = checkRule(plate, rule);
    const weight = issues.reduce((sum, i) => sum + ISSUE_WEIGHT(i), 0);
    if (!best || weight < best.weight) best = { rule, issues, weight };
    if (issues.length === 0) break;
  }

  if (!best) {
    return { status: 'unverified', formatId: null, issues: ['no_matching_format'] };
  }

  const issues = [...best.issues, ...provinceIssues];
  return issues.length === 0
    ? { status: 'valid', formatId: best.rule.id, issues }
    : { status: 'unverified', formatId: null, issues };
}
