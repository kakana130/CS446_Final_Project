import type { Plate } from '@/lib/plate/types';
import { scorePlates, type MatchScore } from './score';

export interface Scored<C> {
  candidate: C;
  score: MatchScore & { kind: NonNullable<MatchScore['kind']> };
}

/**
 * Score candidates against a plate and keep real matches: exact first, then by score, then
 * newest. Pure, so the ranking is unit-tested without a database.
 */
export function selectMatches<C extends { plate: Plate; createdAt: string }>(
  plate: Plate,
  candidates: readonly C[],
  limit = 50,
): Scored<C>[] {
  return candidates
    .map((candidate) => ({ candidate, score: scorePlates(plate, candidate.plate) }))
    .filter((x): x is Scored<C> => x.score.kind !== null)
    .sort(
      (a, b) =>
        Number(b.score.kind === 'exact') - Number(a.score.kind === 'exact') ||
        b.score.score - a.score.score ||
        b.candidate.createdAt.localeCompare(a.candidate.createdAt),
    )
    .slice(0, limit);
}
