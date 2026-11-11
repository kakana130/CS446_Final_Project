import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '@/lib/db/candidates';
import type { MatchToRecord, RecordedMatch } from '@/lib/db/matches';
import { buildPlateRecord } from '@/lib/plate/canonical';
import { normalizePlate } from '@/lib/plate/normalize';

const db = vi.hoisted(() => ({
  candidates: [] as Candidate[],
  recorded: [] as MatchToRecord[][],
  notified: [] as RecordedMatch[][],
}));

vi.mock('@/lib/db/candidates', () => ({
  fetchCandidates: async () => db.candidates,
}));
vi.mock('@/lib/db/matches', () => ({
  recordMatches: async (rows: MatchToRecord[]) => {
    db.recorded.push(rows);
    // The first row is "new", the rest were already recorded (idempotent upsert).
    return rows.map((r, i) => ({
      matchId: `m-${i}`,
      lostPostId: r.lostPostId,
      foundPostId: r.foundPostId,
      kind: r.kind,
      isNew: i === 0,
    }));
  },
}));
vi.mock('@/lib/notify', () => ({
  notifyNewMatches: async (m: RecordedMatch[]) => void db.notified.push(m),
}));

const { matchNewPost } = await import('./run');

const candidate = (id: string, letters: string, number: string): Candidate => ({
  id,
  batchId: `b-${id}`,
  kind: 'found',
  plate: normalizePlate({ type: 'car', letters, number, provinceCode: 'TH-10' }),
  formatStatus: 'valid',
  cropPath: null,
  createdAt: '2026-09-28T00:00:00Z',
});

beforeEach(() => {
  db.candidates = [];
  db.recorded = [];
  db.notified = [];
});

describe('matchNewPost', () => {
  const lostRecord = buildPlateRecord({
    type: 'car',
    letters: 'กข',
    number: '1234',
    provinceCode: 'TH-10',
  });

  it('records only real matches, with the new post on the correct side', async () => {
    db.candidates = [
      candidate('exact', 'กข', '1234'),
      candidate('near', 'กข', '7234'),
      candidate('none', 'มท', '9876'),
    ];
    const result = await matchNewPost({ id: 'lost-1', kind: 'lost', record: lostRecord });

    expect(db.recorded[0]).toEqual([
      { lostPostId: 'lost-1', foundPostId: 'exact', score: 1, kind: 'exact' },
      expect.objectContaining({ lostPostId: 'lost-1', foundPostId: 'near', kind: 'near' }),
    ]);
    expect(result).toHaveLength(2);
  });

  it('puts a new found post on the found side', async () => {
    db.candidates = [{ ...candidate('lost-9', 'กข', '1234'), kind: 'lost' }];
    await matchNewPost({ id: 'found-1', kind: 'found', record: lostRecord });
    expect(db.recorded[0]?.[0]).toMatchObject({ lostPostId: 'lost-9', foundPostId: 'found-1' });
  });

  it('notifies only newly recorded matches', async () => {
    db.candidates = [candidate('a', 'กข', '1234'), candidate('b', 'กข', '1234')];
    await matchNewPost({ id: 'lost-1', kind: 'lost', record: lostRecord });
    expect(db.notified[0]).toHaveLength(1);
    expect(db.notified[0]?.[0]?.isNew).toBe(true);
  });

  it('records nothing when there are no candidates', async () => {
    expect(await matchNewPost({ id: 'lost-1', kind: 'lost', record: lostRecord })).toEqual([]);
    expect(db.recorded[0]).toEqual([]);
    expect(db.notified[0]).toEqual([]);
  });
});
