import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, HEX64, ids, seed } from './fixtures';
import { openTestDb, type TestDb } from './harness';

let db: TestDb;

// An unfinished found upload: a batch that never got a post.
const EMPTY_BATCH = '00000000-0000-4000-8000-00000000b0e1';
const CROP = `${ids.foundBatch}/${ids.foundPost}.webp`;

beforeAll(async () => {
  db = await openTestDb();
});

beforeEach(async () => {
  await db.query(`delete from public.batches where id = $1`, [EMPTY_BATCH]);
  await db.query(`delete from public.feedback where comment like 'retention-test%'`);
  await db.query(`delete from public.pending_storage_deletes where path like 'retention-test/%'`);
  await seed(db);
});

afterAll(async () => {
  await db.query(`delete from public.batches where id = $1`, [EMPTY_BATCH]);
  await db.query(`delete from public.feedback where comment like 'retention-test%'`);
  await db.query(`delete from public.pending_storage_deletes where path like 'retention-test/%'`);
  await cleanup(db);
  await db.close();
});

async function purge() {
  const [row] = await db.query<{ r: Record<string, number> }>(
    `select public.purge_expired_data(90) as r`,
  );
  return row!.r;
}

async function count(sql: string, params: unknown[] = []) {
  const [row] = await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params);
  return row!.n;
}

describe('purge_expired_data (D-089)', () => {
  it('deletes an expired post with everything hanging off it, and queues its crop', async () => {
    await db.query(
      `update public.posts set expires_at = now() - interval '1 minute' where id = $1`,
      [ids.foundPost],
    );
    await db.query(
      `insert into public.contact_reveals (post_id, match_id, ip_hash) values ($1, $2, $3)`,
      [ids.foundPost, ids.match, HEX64],
    );
    await db.query(
      `insert into public.reports (post_id, reason, ip_hash) values ($1, 'scam', $2)`,
      [ids.foundPost, HEX64],
    );

    const result = await purge();

    expect(result.posts).toBe(1);
    expect(await count(`public.posts where id = $1`, [ids.foundPost])).toBe(0);
    expect(await count(`public.matches where id = $1`, [ids.match])).toBe(0);
    expect(await count(`public.reports where post_id = $1`, [ids.foundPost])).toBe(0);
    expect(await count(`public.contact_reveals where post_id = $1`, [ids.foundPost])).toBe(0);
    // The batch and its contacts go once their last post is gone.
    expect(await count(`public.batches where id = $1`, [ids.foundBatch])).toBe(0);
    expect(await count(`public.batch_contacts where batch_id = $1`, [ids.foundBatch])).toBe(0);
    // The photo file itself is removed by the cron route through the Storage API.
    expect(await count(`public.pending_storage_deletes where path = $1`, [CROP])).toBe(1);
  });

  it('keeps posts that have not expired, with their contacts', async () => {
    const result = await purge();
    expect(result.posts).toBe(0);
    expect(
      await count(`public.posts where id = any($1::uuid[])`, [[ids.lostPost, ids.foundPost]]),
    ).toBe(2);
    expect(await count(`public.batch_contacts where batch_id = $1`, [ids.lostBatch])).toBe(1);
    expect(await count(`public.matches where id = $1`, [ids.match])).toBe(1);
  });

  it('removes batches that never got a post after a day, but not fresh ones', async () => {
    await db.query(
      `insert into public.batches (id, kind, device_token_hash, locale, consent_version, created_at)
       values ($1, 'found', $2, 'th', 'v1', now() - interval '2 hours')`,
      [EMPTY_BATCH, HEX64],
    );
    await purge();
    expect(await count(`public.batches where id = $1`, [EMPTY_BATCH])).toBe(1);

    await db.query(
      `update public.batches set created_at = now() - interval '25 hours' where id = $1`,
      [EMPTY_BATCH],
    );
    const result = await purge();
    expect(result.batches).toBe(1);
    expect(await count(`public.batches where id = $1`, [EMPTY_BATCH])).toBe(0);
  });

  it('deletes contact-reveal records after 30 days and feedback after a year', async () => {
    await db.query(
      `insert into public.contact_reveals (post_id, match_id, ip_hash, created_at)
       values ($1, $2, $3, now() - interval '31 days'), ($1, $2, $3, now() - interval '29 days')`,
      [ids.foundPost, ids.match, HEX64],
    );
    await db.query(
      `insert into public.feedback (rating, comment, context, locale, ip_hash, created_at)
       values (5, 'retention-test old', 'general', 'th', $1, now() - interval '366 days'),
              (5, 'retention-test new', 'general', 'th', $1, now() - interval '364 days')`,
      [HEX64],
    );

    const result = await purge();

    expect(result.contact_reveals).toBe(1);
    expect(await count(`public.contact_reveals where post_id = $1`, [ids.foundPost])).toBe(1);
    expect(result.feedback).toBe(1);
    expect(await count(`public.feedback where comment = 'retention-test new'`)).toBe(1);
  });
});

describe('pending storage deletes', () => {
  it('hands out queued paths and forgets the removed ones, counting failures', async () => {
    await db.query(
      `insert into public.pending_storage_deletes (path) values ('retention-test/a'), ('retention-test/b')`,
    );
    const paths = (
      await db.query<{ p: string }>(`select p from public.pending_storage_paths(1000) as p`)
    ).map((r) => r.p);
    expect(paths).toEqual(expect.arrayContaining(['retention-test/a', 'retention-test/b']));

    await db.query(`select public.storage_paths_done($1, $2)`, [
      ['retention-test/a'],
      ['retention-test/b'],
    ]);
    const left = await db.query<{ path: string; attempts: number }>(
      `select path, attempts from public.pending_storage_deletes where path like 'retention-test/%'`,
    );
    expect(left).toEqual([{ path: 'retention-test/b', attempts: 1 }]);
  });

  it('gives up on a path after 10 failed attempts', async () => {
    await db.query(
      `insert into public.pending_storage_deletes (path, attempts) values ('retention-test/stuck', 10)`,
    );
    const paths = (
      await db.query<{ p: string }>(`select p from public.pending_storage_paths(1000) as p`)
    ).map((r) => r.p);
    expect(paths).not.toContain('retention-test/stuck');
  });
});

describe('recent_active_posts (matching safety net)', () => {
  const recent = async () =>
    (
      await db.query<{ id: string; letters: string; number: string }>(
        `select * from public.recent_active_posts(now() - interval '2 days', 1000)`,
      )
    ).filter((r) => r.id === ids.lostPost || r.id === ids.foundPost);

  it('lists active posts from the last days with their plate fields', async () => {
    const rows = await recent();
    expect(rows.map((r) => r.id).sort()).toEqual([ids.lostPost, ids.foundPost].sort());
    expect(rows[0]).toMatchObject({ letters: 'กข', number: '1234' });
  });

  it('leaves out older, expired and closed posts', async () => {
    await db.query(`update public.posts set created_at = now() - interval '3 days' where id = $1`, [
      ids.lostPost,
    ]);
    await db.query(`update public.posts set status = 'resolved' where id = $1`, [ids.foundPost]);
    expect(await recent()).toEqual([]);

    await db.query(
      `update public.posts set created_at = now(), status = 'active',
              expires_at = now() - interval '1 minute' where id = any($1::uuid[])`,
      [[ids.lostPost, ids.foundPost]],
    );
    expect(await recent()).toEqual([]);
  });
});
