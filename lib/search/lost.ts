import 'server-only';
import { fetchCandidates } from '@/lib/db/candidates';
import { selectMatches } from '@/lib/matching/select';
import type { MatchKind } from '@/lib/matching/score';
import type { PlateRecord } from '@/lib/plate/canonical';

/**
 * Is someone looking for this plate? Used while a finder checks each plate, before posting
 * (D-064). Answers only the best match kind: never which post, how many, the province on the
 * lost post, a note or any contact. The real match is recorded when the found plate is posted.
 */
export async function lostWatchStatus(record: PlateRecord): Promise<MatchKind | null> {
  // Candidates "for a found plate" are lost watches.
  const candidates = await fetchCandidates('found', record.plate, record.key);
  return selectMatches(record.plate, candidates, 1)[0]?.score.kind ?? null;
}
