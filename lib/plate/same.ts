import { WILDCARD, type Plate } from './types';

/**
 * Whether two normalized plates are the same plate as far as a person can tell (D-091): same
 * type, prefix digit, letters and number, and the province agrees when both are known. A
 * plate with an unreadable character (`?`) is never "the same" as anything: it may be one of
 * several plates, and matching handles those.
 */
export function samePlate(a: Plate, b: Plate): boolean {
  const hasWildcard = (p: Plate) =>
    `${p.prefixDigit ?? ''}${p.letters}${p.number}`.includes(WILDCARD);
  if (hasWildcard(a) || hasWildcard(b)) return false;
  return (
    a.type === b.type &&
    (a.prefixDigit ?? '') === (b.prefixDigit ?? '') &&
    a.letters === b.letters &&
    a.number === b.number &&
    (!a.provinceCode || !b.provinceCode || a.provinceCode === b.provinceCode)
  );
}
