/**
 * Weighted optimal-string-alignment distance (Damerau–Levenshtein restricted to adjacent
 * transpositions) over Unicode code points. Costs are pluggable so plate matching can make
 * confusable substitutions and wildcards cheap, while province snapping uses plain costs.
 */

export interface EditCosts {
  /** Cost of replacing `a` with `b` (called only when a !== b). */
  substitute(a: string, b: string): number;
  insert: number;
  delete: number;
  /** Cost of swapping two adjacent characters. */
  transpose: number;
}

export const UNIT_COSTS: EditCosts = {
  substitute: () => 1,
  insert: 1,
  delete: 1,
  transpose: 1,
};

export function editDistance(a: string, b: string, costs: EditCosts = UNIT_COSTS): number {
  const s = [...a];
  const t = [...b];
  const m = s.length;
  const n = t.length;
  // d[i][j] = cost of turning s[0..i) into t[0..j)
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) d[i]![0] = d[i - 1]![0]! + costs.delete;
  for (let j = 1; j <= n; j++) d[0]![j] = d[0]![j - 1]! + costs.insert;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const si = s[i - 1]!;
      const tj = t[j - 1]!;
      const sub = si === tj ? 0 : costs.substitute(si, tj);
      let best = Math.min(
        d[i - 1]![j]! + costs.delete,
        d[i]![j - 1]! + costs.insert,
        d[i - 1]![j - 1]! + sub,
      );
      if (i > 1 && j > 1 && si === t[j - 2] && s[i - 2] === tj && si !== tj) {
        best = Math.min(best, d[i - 2]![j - 2]! + costs.transpose);
      }
      d[i]![j] = best;
    }
  }
  return d[m]![n]!;
}

/** 1 for identical strings, 0 for completely different ones (unit costs). */
export function similarity(a: string, b: string): number {
  const len = Math.max([...a].length, [...b].length);
  return len === 0 ? 1 : 1 - editDistance(a, b) / len;
}
