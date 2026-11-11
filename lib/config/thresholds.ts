/**
 * Plate matching thresholds and weights. Covered by lib/matching/score.test.ts, where each
 * value is exercised by realistic examples; change them only together with those tests.
 */
export const matchConfig = {
  /** Substitution / insertion / deletion of an unrelated character. */
  editCost: 1,
  /** Adjacent swap (e.g. 1243 for 1234). */
  transposeCost: 0.8,
  /** `?` against any character. Uncertainty is charged separately via `wildcardPenalty`. */
  wildcardCost: 0,
  /** Subtracted from the similarity for every `?` on either side. */
  wildcardPenalty: 0.04,
  /** More wildcards than this (both sides together) can never produce a match. */
  maxWildcards: 3,
  /** One side has the leading digit, the other doesn't (people often omit the `1` in 1กข). */
  prefixMissingCost: 0.5,

  /**
   * Only the number may be near (D-077): the series (leading digit + letters) must be the same,
   * except where one side typed `?` for an unreadable character (wildcards cost 0).
   */
  maxSeriesCost: 0,
  /** At most about one misread in the number. */
  maxNumberCost: 1,

  /** Both provinces known and equal. */
  provinceMatchBonus: 0.05,
  /**
   * Both provinces known and different: the same letters + number exist in every province, so
   * it is a different plate and never a match (D-077). Kept for the score's ranking.
   */
  provinceMismatchPenalty: 0.28,

  /** Minimum similarity for a "อาจตรงกัน" (near) match. */
  nearThreshold: 0.7,
} as const;

export type MatchConfig = typeof matchConfig;
