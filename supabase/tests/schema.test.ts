import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PLATE_LIMITS } from '@/lib/plate/limits';
import { openTestDb, type TestDb } from './harness';
import { cleanup, ids, seed } from './fixtures';

let db: TestDb;

beforeAll(async () => {
  db = await openTestDb();
});

beforeEach(async () => {
  await seed(db);
});

afterAll(async () => {
  await cleanup(db);
  await db.close();
});

const count = async (sql: string, params?: unknown[]) =>
  Number((await db.query<{ n: string | number }>(sql, params))[0]?.n ?? 0);

describe('provinces seed', () => {
  it('has 77 ISO provinces plus Betong, without Pattaya', async () => {
    expect(await count(`select count(*) as n from public.provinces`)).toBe(78);
    expect(await count(`select count(*) as n from public.provinces where code = 'TH-BTG'`)).toBe(1);
    expect(await count(`select count(*) as n from public.provinces where code = 'TH-S'`)).toBe(0);
  });
});

describe('integrity constraints', () => {
  it('rejects a post whose kind disagrees with its batch', async () => {
    await expect(
      db.query(
        `insert into public.posts (batch_id, kind, plate_type, letters, number, plate_canonical,
                                   plate_key, plate_display, format_status)
         values ($1, 'found', 'car', 'กข', '1', 'x', 'x', 'x', 'valid')`,
        [ids.lostBatch],
      ),
    ).rejects.toThrow();
  });

  it('rejects a crop on a lost post', async () => {
    await expect(
      db.query(
        `insert into public.posts (batch_id, kind, plate_type, letters, number, plate_canonical,
                                   plate_key, plate_display, format_status, crop_path)
         values ($1, 'lost', 'car', 'กข', '1', 'x', 'x', 'x', 'valid', $2)`,
        [ids.lostBatch, `${ids.lostBatch}/${ids.lostPost}.webp`],
      ),
    ).rejects.toThrow();
  });

  it('rejects a match whose sides are swapped', async () => {
    await expect(
      db.query(
        `insert into public.matches (lost_post_id, found_post_id, score, kind)
         values ($1, $2, 0.9, 'near')`,
        [ids.foundPost, ids.lostPost],
      ),
    ).rejects.toThrow();
  });

  it('requires at least one visible contact', async () => {
    await db.query(`delete from public.batch_contacts where batch_id = $1`, [ids.lostBatch]);
    await expect(
      db.query(
        `insert into public.batch_contacts (batch_id, email, show_email_as_contact)
         values ($1, 'a@b.test', false)`,
        [ids.lostBatch],
      ),
    ).rejects.toThrow();
  });

  it('rejects an owner that is not an account', async () => {
    await expect(
      db.query(
        `insert into public.batches (kind, owner_id, locale, consent_version)
         values ('lost', '00000000-0000-4000-8000-0000000000ff', 'th', 'v1')`,
      ),
    ).rejects.toThrow();
  });

  it('rejects finder-only fields on a lost batch', async () => {
    await expect(
      db.query(
        `insert into public.batches (kind, locale, consent_version, district)
         values ('lost', 'th', 'v1', 'บางเขน')`,
      ),
    ).rejects.toThrow();
  });

  it('keeps site_settings to a single row', async () => {
    await expect(db.query(`insert into public.site_settings (id) values (2)`)).rejects.toThrow();
  });
});

describe('plate length limits match lib/plate/limits.ts', () => {
  const insert = (letters: string, number: string) =>
    db.query(
      `insert into public.posts (batch_id, kind, plate_type, letters, number, plate_canonical,
                                 plate_key, plate_display, format_status)
       values ($1, 'lost', 'car', $2, $3, 'x', 'x', 'x', 'unverified')`,
      [ids.lostBatch, letters, number],
    );

  it('stores the longest allowed (unverified) plate', async () => {
    await expect(
      insert('ก'.repeat(PLATE_LIMITS.letters), '9'.repeat(PLATE_LIMITS.number)),
    ).resolves.toBeDefined();
  });

  it('rejects anything longer', async () => {
    await expect(insert('ก'.repeat(PLATE_LIMITS.letters + 1), '1')).rejects.toThrow();
    await expect(insert('กข', '9'.repeat(PLATE_LIMITS.number + 1))).rejects.toThrow();
  });
});

describe('real deletion', () => {
  it('deleting the last post removes the batch, contacts, push subscriptions and matches', async () => {
    await db.query(`delete from public.posts where id = $1`, [ids.lostPost]);
    expect(
      await count(`select count(*) as n from public.batches where id = $1`, [ids.lostBatch]),
    ).toBe(0);
    expect(
      await count(`select count(*) as n from public.batch_contacts where batch_id = $1`, [
        ids.lostBatch,
      ]),
    ).toBe(0);
    expect(
      await count(`select count(*) as n from public.push_subscriptions where batch_id = $1`, [
        ids.lostBatch,
      ]),
    ).toBe(0);
    expect(await count(`select count(*) as n from public.matches where id = $1`, [ids.match])).toBe(
      0,
    );
  });

  it('queues the crop object for Storage deletion', async () => {
    await db.query(`delete from public.posts where id = $1`, [ids.foundPost]);
    expect(
      await count(`select count(*) as n from public.pending_storage_deletes where path = $1`, [
        `${ids.foundBatch}/${ids.foundPost}.webp`,
      ]),
    ).toBe(1);
  });

  it('deleting a batch cascades to its posts and queues their crops', async () => {
    await db.query(`delete from public.batches where id = $1`, [ids.foundBatch]);
    expect(
      await count(`select count(*) as n from public.posts where batch_id = $1`, [ids.foundBatch]),
    ).toBe(0);
    expect(
      await count(`select count(*) as n from public.pending_storage_deletes where path like $1`, [
        `${ids.foundBatch}/%`,
      ]),
    ).toBe(1);
  });

  it('keeps the batch while other posts remain', async () => {
    await db.query(
      `insert into public.posts (batch_id, kind, plate_type, letters, number, plate_canonical,
                                 plate_key, plate_display, format_status, crop_path)
       values ($1, 'found', 'car', 'ขค', '55', 'x', 'ขค55', 'x', 'valid', $2)`,
      [ids.foundBatch, `${ids.foundBatch}/00000000-0000-4000-8000-00000000a003.webp`],
    );
    await db.query(`delete from public.posts where id = $1`, [ids.foundPost]);
    expect(
      await count(`select count(*) as n from public.batches where id = $1`, [ids.foundBatch]),
    ).toBe(1);
  });
});

describe('rl_hit', () => {
  it('allows up to the limit within a window, then denies', async () => {
    const hit = async () =>
      (
        await db.query<{ allowed: boolean; hits: number }>(
          `select * from public.rl_hit('test:pin', 'subject-1', 3600, 3)`,
        )
      )[0];
    expect(await hit()).toMatchObject({ allowed: true, hits: 1 });
    expect(await hit()).toMatchObject({ allowed: true, hits: 2 });
    expect(await hit()).toMatchObject({ allowed: true, hits: 3 });
    expect(await hit()).toMatchObject({ allowed: false, hits: 4 });
  });

  it('counts subjects independently', async () => {
    await db.query(`select * from public.rl_hit('test:pin', 'a', 3600, 1)`);
    const b = (
      await db.query<{ allowed: boolean }>(`select * from public.rl_hit('test:pin', 'b', 3600, 1)`)
    )[0];
    expect(b?.allowed).toBe(true);
  });
});

describe('pg_trgm with Thai plate keys', () => {
  it('tokenizes Thai consonants (locale treats them as word characters)', async () => {
    const [row] = await db.query<{ s: number }>(
      `select extensions.similarity('กข1234', 'กข1235') as s`,
    );
    // If Thai were dropped as non-word characters only digits would remain and the
    // score would collapse; see docs/decisions.md (D-015) for the fallback.
    expect(row!.s).toBeGreaterThan(0.4);
    const [diff] = await db.query<{ s: number }>(
      `select extensions.similarity('กข1234', 'ขค1234') as s`,
    );
    expect(diff!.s).toBeLessThan(row!.s);
  });
});

describe('plate_candidates', () => {
  it('finds the opposite-kind post by trigram similarity', async () => {
    const rows = await db.query<{ id: string }>(
      `select id from public.plate_candidates('lost', 'car', 'กข1235', '1235')`,
    );
    expect(rows.map((r) => r.id)).toContain(ids.foundPost);
    expect(rows.map((r) => r.id)).not.toContain(ids.lostPost);
  });

  it('finds a post with the same number even when letters differ completely', async () => {
    const rows = await db.query<{ id: string }>(
      `select id from public.plate_candidates('lost', 'car', 'ฮฮ1234', '1234')`,
    );
    expect(rows.map((r) => r.id)).toContain(ids.foundPost);
  });

  it('skips posts that are not active', async () => {
    await db.query(`update public.posts set status = 'needs_review' where id = $1`, [
      ids.foundPost,
    ]);
    const rows = await db.query<{ id: string }>(
      `select id from public.plate_candidates('lost', 'car', 'กข1234', '1234')`,
    );
    expect(rows.map((r) => r.id)).not.toContain(ids.foundPost);
  });

  it('keeps car and motorcycle apart but lets "other" match either', async () => {
    const moto = await db.query<{ id: string }>(
      `select id from public.plate_candidates('lost', 'motorcycle', 'กข1234', '1234')`,
    );
    expect(moto.map((r) => r.id)).not.toContain(ids.foundPost);
    const other = await db.query<{ id: string }>(
      `select id from public.plate_candidates('lost', 'other', 'กข1234', '1234')`,
    );
    expect(other.map((r) => r.id)).toContain(ids.foundPost);
  });
});
