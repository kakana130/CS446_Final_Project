import 'server-only';
import { SEARCH_RESULT_LIMIT } from '@/lib/config/app';
import { fetchCandidates } from '@/lib/db/candidates';
import { signCropUrls } from '@/lib/db/storage';
import { selectMatches } from '@/lib/matching/select';
import type { MatchKind } from '@/lib/matching/score';
import type { PlateRecord } from '@/lib/plate/canonical';
import type { Plate } from '@/lib/plate/types';

export interface FoundSearchResult {
  postId: string;
  kind: MatchKind;
  plate: Plate;
  formatStatus: 'valid' | 'unverified';
  createdAt: string;
  cropUrl: string | null;
}

/**
 * Search FOUND posts only. Lost watches are never searchable (D-002): listing who lost which
 * plate would hand scammers a target list. No contact details or district in results.
 */
export async function searchFoundPosts(record: PlateRecord): Promise<FoundSearchResult[]> {
  // Candidates "for a lost plate" are found posts.
  const candidates = await fetchCandidates('lost', record.plate, record.key);
  const hits = selectMatches(record.plate, candidates, SEARCH_RESULT_LIMIT);
  const urls = await signCropUrls(
    hits.flatMap(({ candidate }) => (candidate.cropPath ? [candidate.cropPath] : [])),
  );
  return hits.map(({ candidate, score }) => ({
    postId: candidate.id,
    kind: score.kind,
    plate: candidate.plate,
    formatStatus: candidate.formatStatus,
    createdAt: candidate.createdAt,
    cropUrl: candidate.cropPath ? (urls.get(candidate.cropPath) ?? null) : null,
  }));
}
