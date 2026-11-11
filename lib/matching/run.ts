import 'server-only';
import { fetchCandidates } from '@/lib/db/candidates';
import { recordMatches, type RecordedMatch } from '@/lib/db/matches';
import { logError } from '@/lib/log';
import { notifyNewMatches } from '@/lib/notify';
import type { PlateRecord } from '@/lib/plate/canonical';
import { selectMatches } from './select';

export interface NewPost {
  id: string;
  kind: 'lost' | 'found';
  record: PlateRecord;
}

/**
 * Instant matching for a post that was just inserted (spec §5): retrieve candidates of the
 * opposite kind, score them, record matches, and notify lost-plate owners of new ones.
 * Runs in the same request, after the insert has committed.
 */
export async function matchNewPost(post: NewPost): Promise<RecordedMatch[]> {
  const candidates = await fetchCandidates(post.kind, post.record.plate, post.record.key);
  const hits = selectMatches(post.record.plate, candidates);
  const recorded = await recordMatches(
    hits.map(({ candidate, score }) => ({
      lostPostId: post.kind === 'lost' ? post.id : candidate.id,
      foundPostId: post.kind === 'found' ? post.id : candidate.id,
      score: score.score,
      kind: score.kind,
    })),
  );
  // An alert failure must not fail matching: the match is recorded and shows on the site.
  try {
    await notifyNewMatches(recorded.filter((m) => m.isNew));
  } catch (err) {
    logError('matching:notify', err);
  }
  return recorded;
}
