/**
 * Characters that OCR and people reading muddy, bent plates commonly mix up.
 *
 * - In scoring, a substitution between two characters of a group costs `cost` instead of 1.
 * - Groups with cost <= FOLD_MAX_COST are also *folded* to one representative in
 *   `plate_key`, so trigram candidate retrieval finds them. Changing folding requires
 *   recomputing `posts.plate_key` for existing rows.
 *
 * Costs are starting points; Phase 6 evaluation (docs/ocr-eval.md) tunes them from real
 * confusion counts.
 */

export interface ConfusableGroup {
  chars: readonly string[];
  cost: number;
  why: string;
}

export const FOLD_MAX_COST = 0.3;

export const CONFUSABLE_GROUPS: readonly ConfusableGroup[] = [
  // Thai consonants: strong (differ by a small tail, head or notch)
  { chars: ['ข', 'ช'], cost: 0.3, why: 'notch on the head' },
  { chars: ['ช', 'ซ'], cost: 0.3, why: 'extra tail stroke' },
  { chars: ['ด', 'ต'], cost: 0.3, why: 'notch on top' },
  { chars: ['บ', 'ป'], cost: 0.3, why: 'ascender on ป' },
  { chars: ['ผ', 'พ', 'ฟ', 'ฝ'], cost: 0.3, why: 'same body, differ by ascender/notch' },
  { chars: ['ภ', 'ถ'], cost: 0.3, why: 'tail vs loop at the foot' },
  { chars: ['ศ', 'ส', 'ษ'], cost: 0.3, why: 'same body, differ by tail/inner stroke' },
  { chars: ['ฎ', 'ฏ'], cost: 0.3, why: 'foot ornament' },
  // Thai consonants: weaker
  { chars: ['ค', 'ด'], cost: 0.5, why: 'head loop direction' },
  { chars: ['อ', 'ฮ'], cost: 0.5, why: 'ฮ is อ with a tail' },
  { chars: ['ม', 'ฆ'], cost: 0.5, why: 'similar body' },
  { chars: ['ร', 'ธ'], cost: 0.5, why: 'ธ adds a stroke' },
  { chars: ['ท', 'ฑ'], cost: 0.5, why: 'ฑ adds a flourish' },
  { chars: ['ห', 'ท'], cost: 0.5, why: 'similar in condensed plate type' },
  // Digits
  { chars: ['8', '0'], cost: 0.3, why: 'closed shapes, mud fills the waist' },
  { chars: ['1', '7'], cost: 0.3, why: 'serif/flag' },
  { chars: ['3', '8'], cost: 0.5, why: 'left side occluded' },
  { chars: ['5', '6'], cost: 0.5, why: 'lower loop' },
  { chars: ['6', '8'], cost: 0.5, why: 'upper loop' },
  { chars: ['9', '0'], cost: 0.5, why: 'lower tail' },
];

const pairCost = new Map<string, number>();
for (const group of CONFUSABLE_GROUPS) {
  for (const a of group.chars) {
    for (const b of group.chars) {
      if (a === b) continue;
      const key = a + b;
      pairCost.set(key, Math.min(pairCost.get(key) ?? Infinity, group.cost));
    }
  }
}

/** Substitution cost for a confusable pair, or null if the pair is not confusable. */
export function confusableCost(a: string, b: string): number | null {
  return pairCost.get(a + b) ?? null;
}

// Union–find over strong groups: folding must be an equivalence (transitive).
const parent = new Map<string, string>();
const find = (c: string): string => {
  const p = parent.get(c);
  if (p === undefined || p === c) return c;
  const root = find(p);
  parent.set(c, root);
  return root;
};
for (const group of CONFUSABLE_GROUPS.filter((g) => g.cost <= FOLD_MAX_COST)) {
  for (const c of group.chars) if (!parent.has(c)) parent.set(c, c);
  const roots = group.chars.map(find);
  const target = roots.reduce((min, r) => (r < min ? r : min));
  for (const r of roots) parent.set(r, target);
}

/** Map every character to the representative of its strong confusable class. */
export function foldConfusables(s: string): string {
  return [...s].map((c) => (parent.has(c) ? find(c) : c)).join('');
}
