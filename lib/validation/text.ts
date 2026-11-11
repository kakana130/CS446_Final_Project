/**
 * Anti-scam and privacy checks for free-text fields (police station note, district, later
 * feedback and report notes). Scammers put payment details or links in any field they can;
 * people also overshare. Pure functions: used by both the form and the API.
 */

export type UnsafeTextReason = 'url' | 'id_number' | 'account_number';

const URL_PATTERNS = [
  /\bhttps?:\/\//i,
  /\bwww\./i,
  /\b(?:line\.me|lin\.ee|t\.me|bit\.ly|wa\.me|m\.me|fb\.me|tinyurl\.com)\b/i,
  /\b[a-z0-9-]{2,}\.(?:com|net|org|co|io|me|ly|th|app|link|xyz|info|shop|site|online)\b/i,
];

/**
 * Returns why a text is not allowed, or null when it's fine.
 * - `url`: links (scam landing pages, LINE invite links)
 * - `id_number`: 13 digits (Thai national ID, also a PromptPay key)
 * - `account_number`: 10–15 digits (bank accounts, PromptPay phone numbers)
 * Digits separated by spaces, dashes or dots are joined first ("123-4-56789-0").
 */
export function findUnsafeText(text: string): UnsafeTextReason | null {
  if (URL_PATTERNS.some((re) => re.test(text))) return 'url';
  const runs = text.replace(/(?<=\d)[\s.\-–]+(?=\d)/g, '').match(/\d+/g) ?? [];
  if (runs.some((r) => r.length === 13)) return 'id_number';
  if (runs.some((r) => r.length >= 10 && r.length <= 15)) return 'account_number';
  return null;
}

/** District names never contain digits; rejecting them also blocks house numbers. */
export function isSafeDistrict(text: string): boolean {
  return !/[0-9๐-๙]/u.test(text) && findUnsafeText(text) === null;
}
