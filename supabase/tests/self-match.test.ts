import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, ids, seed } from './fixtures';
import { openTestDb, type TestDb } from './harness';

let db: TestDb;

beforeAll(async () => {
  db = await openTestDb();
});

beforeEach(async () => {
  await seed(db);
  // Start from the two posts without the fixture's match.
  await db.query(`delete from public.matches where id = $1`, [ids.match]);
});

afterAll(async () => {
  await cleanup(db);
  await db.close();
});

const pair = () =>
  JSON.stringify([
    { lost_post_id: ids.lostPost, found_post_id: ids.foundPost, score: 1, kind: 'exact' },
  ]);

async function record() {
  return db.query<{ out_match_id: string | null }>(
    `select * from public.record_matches($1::jsonb)`,
    [pair()],
  );
}

async function matchCount() {
  const [row] = await db.query<{ n: number }>(
    `select count(*)::int as n from public.matches where lost_post_id = $1 and found_post_id = $2`,
    [ids.lostPost, ids.foundPost],
  );
  return row!.n;
}

describe('record_matches never matches an account with itself (D-091)', () => {
  it('skips a lost and a found post made by the same account', async () => {
    await db.query(`update public.batches set owner_id = $1 where id = any($2::uuid[])`, [
      ids.user,
      [ids.lostBatch, ids.foundBatch],
    ]);
    expect(await record()).toEqual([]);
    expect(await matchCount()).toBe(0);
  });

  it('still matches posts of different people, or posted signed out', async () => {
    await db.query(`update public.batches set owner_id = $1 where id = $2`, [
      ids.user,
      ids.lostBatch,
    ]);
    expect(await record()).toHaveLength(1);
    expect(await matchCount()).toBe(1);

    await db.query(`delete from public.matches where lost_post_id = $1`, [ids.lostPost]);
    await db.query(`update public.batches set owner_id = null where id = any($1::uuid[])`, [
      [ids.lostBatch, ids.foundBatch],
    ]);
    expect(await record()).toHaveLength(1);
  });
});
