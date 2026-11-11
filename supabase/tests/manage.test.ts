import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, type TestDb } from './harness';
import { HEX64 } from './fixtures';

let db: TestDb;
const created: string[] = [];

const USER = '00000000-0000-4000-8000-0000000000e7';
const OTHER = '00000000-0000-4000-8000-0000000000e8';

async function createLost(
  letters: string,
  number: string,
  prefix: string | null = null,
  owner: string | null = null,
) {
  const [row] = await db.query<{ out_batch_id: string; out_post_id: string }>(
    `select * from public.create_lost_watch($1,$2,'th','v1','owner.line',null,null,false,false,
       'car',$3,$4,$5,'TH-10',$6,$7,$8,false,'valid')`,
    [
      owner,
      HEX64,
      prefix,
      letters,
      number,
      `car|${prefix ?? ''}|${letters}|${number}|TH-10`,
      `${prefix ?? ''}${letters}${number}`,
      `${prefix ?? ''}${letters} ${number}`,
    ],
  );
  created.push(row!.out_batch_id);
  return row!;
}

beforeAll(async () => {
  db = await openTestDb();
  await db.query(`insert into auth.users (id) values ($1), ($2) on conflict do nothing`, [
    USER,
    OTHER,
  ]);
});

afterAll(async () => {
  if (created.length) {
    await db.query(`delete from public.batches where id = any($1::uuid[])`, [created]);
  }
  await db.query(`delete from public.pending_storage_deletes where path like '%'`);
  await db.query(`delete from auth.users where id = any($1::uuid[])`, [[USER, OTHER]]);
  await db.close();
});

describe('accounts (D-085)', () => {
  const owner = async (batch: string) =>
    (
      await db.query<{ owner_id: string | null }>(
        `select owner_id from public.batches where id = $1`,
        [batch],
      )
    )[0]!.owner_id;

  it('a post made while signed in belongs to the account', async () => {
    const { out_batch_id: b } = await createLost('ฬซ', '1212', null, USER);
    expect(await owner(b)).toBe(USER);
    const ok = async (user: string) =>
      (await db.query<{ ok: boolean }>(`select public.batch_owned_by($1, $2) as ok`, [b, user]))[0]!
        .ok;
    expect(await ok(USER)).toBe(true);
    expect(await ok(OTHER)).toBe(false);
  });

  it("signing in links this device's posts, never another account's", async () => {
    const mine = await createLost('ฬฌ', '1313');
    const theirs = await createLost('ฬฌ', '1414', null, OTHER);
    const [r] = await db.query<{ n: number }>(
      `select public.claim_batches($1, $2::uuid[], $3::text[]) as n`,
      [USER, [mine.out_batch_id, theirs.out_batch_id], [HEX64, HEX64]],
    );
    expect(r!.n).toBe(1);
    expect(await owner(mine.out_batch_id)).toBe(USER);
    expect(await owner(theirs.out_batch_id)).toBe(OTHER);
    // A wrong token links nothing.
    const other = await createLost('ฬฌ', '1515');
    await db.query(`select public.claim_batches($1, $2::uuid[], $3::text[])`, [
      USER,
      [other.out_batch_id],
      ['c'.repeat(64)],
    ]);
    expect(await owner(other.out_batch_id)).toBeNull();
  });

  it("my_posts lists this device's posts plus the account's", async () => {
    const device = await createLost('ฬญ', '1616');
    const account = await createLost('ฬญ', '1717', null, OTHER);
    const ids = async (user: string | null) =>
      (
        await db.query<{ post_id: string }>(
          `select post_id from public.my_posts($1::uuid[], $2::text[], $3)`,
          [[device.out_batch_id], [HEX64], user],
        )
      ).map((r) => r.post_id);
    expect(await ids(null)).toEqual([device.out_post_id]);
    expect(await ids(OTHER)).toEqual(
      expect.arrayContaining([device.out_post_id, account.out_post_id]),
    );
  });

  it("match roles and the finder's view of the owner's contact", async () => {
    const lost = await createLost('ฬฮ', '1818', null, USER);
    const [fb] = await db.query<{ id: string }>(
      `select public.create_found_batch($1,$2,$3, now() + interval '30 minutes', 'th', 'v1',
                                        'with_finder', null, null, 'finder.line', null, null,
                                        false) as id`,
      [OTHER, HEX64, 'b'.repeat(64)],
    );
    created.push(fb!.id);
    const [found] = await db.query<{ id: string }>(
      `select public.add_found_plate($1,$2,'00000000-0000-4000-9000-0000000e0001','car',null,
                                     'ฬฮ','1818','TH-10','car||ฬฮ|1818|TH-10','ฬฮ1818',
                                     'ฬฮ 1818',false,'valid',$3,'active','{}',null,20) as id`,
      [fb!.id, 'b'.repeat(64), `${fb!.id}/00000000-0000-4000-9000-0000000e0001.webp`],
    );
    const [m] = await db.query<{ out_match_id: string }>(
      `select * from public.record_matches($1::jsonb)`,
      [
        JSON.stringify([
          { lost_post_id: lost.out_post_id, found_post_id: found!.id, score: 1, kind: 'exact' },
        ]),
      ],
    );
    const roles = async (user: string) =>
      (
        await db.query<{ is_finder: boolean; is_owner: boolean }>(
          `select * from public.match_roles($1, $2)`,
          [m!.out_match_id, user],
        )
      )[0];
    expect(await roles(USER)).toEqual({ is_finder: false, is_owner: true });
    expect(await roles(OTHER)).toEqual({ is_finder: true, is_owner: false });

    const reveal = (user: string) =>
      db.query<{ line_id: string | null }>(
        `select * from public.reveal_owner_contact_for_user($1, $2, $3)`,
        [m!.out_match_id, user, 'd'.repeat(64)],
      );
    expect(await reveal(USER)).toHaveLength(0); // the owner is not the finder
    expect(await reveal(OTHER)).toEqual([expect.objectContaining({ line_id: 'owner.line' })]);
  });

  it('deleting the account keeps the posts (they stay manageable on the device)', async () => {
    await db.query(`insert into auth.users (id) values ($1)`, [
      '00000000-0000-4000-8000-0000000000e9',
    ]);
    const { out_batch_id: b } = await createLost(
      'ฬฯ',
      '1919',
      null,
      '00000000-0000-4000-8000-0000000000e9',
    );
    await db.query(`delete from auth.users where id = $1`, [
      '00000000-0000-4000-8000-0000000000e9',
    ]);
    expect(await owner(b)).toBeNull();
  });
});

describe('batch_owned / batch_posts', () => {
  it('checks the device token and lists the posts', async () => {
    const { out_batch_id: id, out_post_id } = await createLost('ฬก', '3333');
    const own = async (hash: string) =>
      (await db.query<{ ok: boolean }>(`select public.batch_owned($1, $2) as ok`, [id, hash]))[0]!
        .ok;
    expect(await own(HEX64)).toBe(true);
    expect(await own('c'.repeat(64))).toBe(false);
    const posts = await db.query<{ post_id: string; status: string }>(
      `select * from public.batch_posts($1)`,
      [id],
    );
    expect(posts).toEqual([expect.objectContaining({ post_id: out_post_id, status: 'active' })]);
  });
});

describe('manage_post', () => {
  const act = async (batch: string, post: string | null, action: string) =>
    (
      await db.query<{ n: number }>(`select public.manage_post($1, $2, $3) as n`, [
        batch,
        post,
        action,
      ])
    )[0]!.n;

  it('resolves: the post stops being active', async () => {
    const { out_batch_id: b, out_post_id: p } = await createLost('ฬข', '4444');
    expect(await act(b, p, 'resolve')).toBe(1);
    const [row] = await db.query<{ status: string }>(
      `select status from public.posts where id = $1`,
      [p],
    );
    expect(row?.status).toBe('resolved');
    expect(await act(b, p, 'resolve')).toBe(0);
  });

  it('extends by 30 days, at most to 90 days after posting', async () => {
    const { out_batch_id: b, out_post_id: p } = await createLost('ฬค', '5555');
    const days = async () =>
      (
        await db.query<{ d: number }>(
          `select round(extract(epoch from expires_at - created_at) / 86400)::int as d
           from public.posts where id = $1`,
          [p],
        )
      )[0]!.d;
    expect(await days()).toBe(60);
    expect(await act(b, p, 'extend')).toBe(1);
    expect(await days()).toBe(90);
    expect(await act(b, p, 'extend')).toBe(0);
    expect(await days()).toBe(90);
  });

  it('deletes the post and the empty batch', async () => {
    const { out_batch_id: b, out_post_id: p } = await createLost('ฬง', '6666');
    expect(await act(b, p, 'delete')).toBe(1);
    expect(await db.query(`select 1 from public.batches where id = $1`, [b])).toHaveLength(0);
  });

  it('never touches another batch, and rejects unknown actions', async () => {
    const one = await createLost('ฬจ', '7777');
    const two = await createLost('ฬจ', '8888');
    expect(await act(one.out_batch_id, two.out_post_id, 'delete')).toBe(0);
    expect(
      await db.query(`select 1 from public.posts where id = $1`, [two.out_post_id]),
    ).toHaveLength(1);
    await expect(act(one.out_batch_id, null, 'drop')).rejects.toThrow();
  });
});
