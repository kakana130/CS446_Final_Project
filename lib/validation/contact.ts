/**
 * Contact field formats. Pure functions shared by forms and API. They normalize where it's
 * unambiguous (phone formatting, LINE ID case) and return null when the value is invalid.
 */

/**
 * LINE IDs: 4–20 characters of a–z, 0–9, `.`, `-`, `_` (case-insensitive). Official accounts
 * start with `@`. People often paste "@myid" or "ID: myid"; the label is stripped.
 */
export function normalizeLineId(raw: string): string | null {
  const v = raw
    .trim()
    .replace(/^(?:line\s*id|line|ไลน์|id)\s*[:：]?\s*/i, '')
    .toLowerCase();
  return /^@?[a-z0-9._-]{4,20}$/.test(v) ? v : null;
}

/**
 * Thai phone numbers → `0XXXXXXXXX`. Accepts spaces, dashes, dots, parentheses and the +66 /
 * 66 country code. Mobile numbers have 10 digits (06/08/09); landlines 9 digits (02–07).
 */
export function normalizeThaiPhone(raw: string): string | null {
  let digits = raw
    .replace(/[\s\-.()]/g, '')
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
  if (digits.startsWith('+66')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('66') && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (/^0[689]\d{8}$/.test(digits)) return digits;
  if (/^0[2-7]\d{7}$/.test(digits)) return digits;
  return null;
}

/** Deliberately simple: the address only has to work for a confirmation link. */
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null;
}
