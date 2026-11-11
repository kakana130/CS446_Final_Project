import { matchConfig, type MatchConfig } from '@/lib/config/thresholds';
import { confusableCost } from '@/lib/plate/confusables.config';
import { editDistance, type EditCosts } from '@/lib/plate/distance';
import { WILDCARD, type Plate } from '@/lib/plate/types';

export type MatchKind = 'exact' | 'near';

export interface MatchScore {
  /** 0..1, higher is more similar. */
  score: number;
  /** null when the pair should not be shown as a match. */
  kind: MatchKind | null;
  details: {
    seriesCost: number;
    numberCost: number;
    wildcards: number;
    province: 'match' | 'mismatch' | 'unknown';
  };
}

const NO_MATCH = (details: MatchScore['details']): MatchScore => ({
  score: 0,
  kind: null,
  details,
});

function plateCosts(cfg: MatchConfig): EditCosts {
  return {
    substitute: (a, b) =>
      a === WILDCARD || b === WILDCARD ? cfg.wildcardCost : (confusableCost(a, b) ?? cfg.editCost),
    insert: cfg.editCost,
    delete: cfg.editCost,
    transpose: cfg.transposeCost,
  };
}

function prefixCost(
  a: string | null,
  b: string | null,
  costs: EditCosts,
  cfg: MatchConfig,
): number {
  if (a === b) return 0;
  if (a === null || b === null) return cfg.prefixMissingCost;
  return costs.substitute(a, b);
}

const countWildcards = (p: Plate) =>
  [...`${p.prefixDigit ?? ''}${p.letters}${p.number}`].filter((c) => c === WILDCARD).length;

const typesCompatible = (a: Plate, b: Plate) =>
  a.type === b.type || a.type === 'other' || b.type === 'other';

/**
 * Similarity between two normalized plates (symmetric).
 *
 * - `exact`  → "ตรงกัน": same prefix, letters and number, no wildcards, same known province.
 * - `near`   → "อาจตรงกัน": the same series (leading digit + letters, `?` allowed) and province
 *              (or one unknown); only the number may differ by about one misread (D-077).
 *              The user must compare the photo.
 */
export function scorePlates(a: Plate, b: Plate, cfg: MatchConfig = matchConfig): MatchScore {
  const costs = plateCosts(cfg);
  const wildcards = countWildcards(a) + countWildcards(b);
  const province: MatchScore['details']['province'] =
    a.provinceCode === null || b.provinceCode === null
      ? 'unknown'
      : a.provinceCode === b.provinceCode
        ? 'match'
        : 'mismatch';

  const seriesCost =
    prefixCost(a.prefixDigit, b.prefixDigit, costs, cfg) +
    editDistance(a.letters, b.letters, costs);
  const numberCost = editDistance(a.number, b.number, costs);
  const details = { seriesCost, numberCost, wildcards, province };

  if (!typesCompatible(a, b) || a.number === '' || b.number === '') return NO_MATCH(details);

  const isExact =
    wildcards === 0 &&
    province === 'match' &&
    a.prefixDigit === b.prefixDigit &&
    a.letters === b.letters &&
    a.number === b.number;

  const length = Math.max(
    [...`${a.prefixDigit ?? ''}${a.letters}${a.number}`].length,
    [...`${b.prefixDigit ?? ''}${b.letters}${b.number}`].length,
  );
  let score = 1 - (seriesCost + numberCost) / length;
  score -= wildcards * cfg.wildcardPenalty;
  if (province === 'match') score += cfg.provinceMatchBonus;
  if (province === 'mismatch') score -= cfg.provinceMismatchPenalty;
  score = Math.min(1, Math.max(0, score));
  // Round to keep results stable across floating-point noise.
  score = Math.round(score * 1000) / 1000;

  if (isExact) return { score: 1, kind: 'exact', details };

  const near =
    province !== 'mismatch' &&
    wildcards <= cfg.maxWildcards &&
    seriesCost <= cfg.maxSeriesCost &&
    numberCost <= cfg.maxNumberCost &&
    score >= cfg.nearThreshold;

  return { score, kind: near ? 'near' : null, details };
}
