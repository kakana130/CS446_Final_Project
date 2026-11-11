import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTestDb, type TestDb } from './harness';
import { HEX64 } from './fixtures';

let db: TestDb;
const created: string[] = [];
const ip = (n: number) => String(n).repeat(64).slice(0, 64);

async function createLost(letters: string, number: string) {
  const [row] = await db.query<{ out_batch_id: string; out_post_id: string }>(
    `select * from public.create_lost_watch($1,$2,'th','v1','owner.line',null,null,false,false,
       'car',null,$3,$4,'TH-10',$5,$6,$7,false,'valid')`,
    [
      null,
      HEX64,
      letters,
      number,
      `car||${letters}|${number}|TH-10`,
      `${letters}${number}`,
      `${letters} ${number}`,
    ],
  );
  created.push(row!.out_batch_id);
  return row!;
}

const status = async (postId: string) =>
  (await db.query<{ status: string }>(`select status from public.posts where id = $1`, [postId]))[0]
    ?.status;

beforeAll(async () => {
  db = await openTestDb();
});

afterAll(async () => {
  if (created.length) {
    await db.query(`delete from public.batches where id = any($1::uuid[])`, [created]);
  }
  await db.query(`delete from public.feedback`);
  await db.query(`update public.site_settings set mode = 'active'`);
  await db.close();
});

describe('report_post', () => {
  const report = async (post: string, n: number) =>
    (
      await db.query<{ r: string }>(`select public.report_post($1, 'scam', ' note ', $2) as r`, [
        post,
        ip(n),
      ])
    )[0]!.r;

  it('takes one report per IP and hides the post after three reporters', async () => {
    const { out_post_id: p } = await createLost('ฬซ', '1001');
    expect(await report(p, 1)).toBe('reported');
    expect(await report(p, 1)).toBe('duplicate');
    expect(await report(p, 2)).toBe('reported');
    expect(await status(p)).toBe('active');
    expect(await report(p, 3)).toBe('reported');
    expect(await status(p)).toBe('hidden');
    expect(await report(p, 4)).toBe('not_found'); // hidden posts take no more reports
    const [note] = await db.query<{ note: string }>(
      `select note from public.reports where post_id = $1 limit 1`,
      [p],
    );
    expect(note?.note).toBe('note');
  });
});

describe('submit_feedback / admin_feedback', () => {
  it('stores feedback and lists it without the IP', async () => {
    await db.query(`select public.submit_feedback(5, ' ดีมาก ', 'general', 'th', $1)`, [ip(5)]);
    const rows = await db.query<Record<string, unknown>>(`select * from public.admin_feedback(10)`);
    expect(rows[0]).toMatchObject({ rating: 5, comment: 'ดีมาก', context: 'general' });
    expect(Object.keys(rows[0]!)).not.toContain('ip_hash');
  });
});

describe('admin_post_action', () => {
  const act = async (action: string, post: string) =>
    (
      await db.query<{ n: number }>(`select public.admin_post_action($1, $2) as n`, [action, post])
    )[0]!.n;

  it('hides, restores, dismisses reports and deletes, logging every action', async () => {
    const { out_post_id: p, out_batch_id: b } = await createLost('ฬญ', '2002');
    await db.query(`select public.report_post($1, 'other', null, $2)`, [p, ip(7)]);
    expect(await act('hide', p)).toBe(1);
    expect(await status(p)).toBe('hidden');
    expect(await act('restore', p)).toBe(1);
    expect(await status(p)).toBe('active');
    expect(await act('dismiss', p)).toBe(1);
    expect(await db.query(`select 1 from public.reports where post_id = $1`, [p])).toHaveLength(0);
    expect(await act('delete', p)).toBe(1);
    expect(await db.query(`select 1 from public.batches where id = $1`, [b])).toHaveLength(0);

    const log = await db.query<{ action: string }>(`select action from public.admin_audit(20)`);
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining(['post_hide', 'post_restore', 'post_dismiss', 'post_delete']),
    );
    await expect(act('explode', p)).rejects.toThrow();
  });
});

describe('admin restore after reports', () => {
  it('starts the report count over, so one new report does not hide it again', async () => {
    const { out_post_id: p } = await createLost('ฬฑ', '4004');
    for (const n of [11, 12, 13]) {
      await db.query(`select public.report_post($1, 'scam', null, $2)`, [p, ip(n)]);
    }
    expect(await status(p)).toBe('hidden');
    await db.query(`select public.admin_post_action('restore', $1)`, [p]);
    expect(await status(p)).toBe('active');
    await db.query(`select public.report_post($1, 'scam', null, $2)`, [p, ip(14)]);
    expect(await status(p)).toBe('active');
  });
});

describe('admin reads', () => {
  it('finds posts by plate text and lists reported posts', async () => {
    const { out_post_id: p } = await createLost('ฬฐ', '3003');
    await db.query(`select public.report_post($1, 'personal_data', null, $2)`, [p, ip(8)]);
    const found = await db.query<{ post_id: string }>(
      `select * from public.admin_find_posts('ฬฐ 30', 10)`,
    );
    expect(found.map((f) => f.post_id)).toContain(p);
    const reported = await db.query<{ post_id: string; reports: unknown[] }>(
      `select * from public.admin_reported_posts(10)`,
    );
    const row = reported.find((r) => r.post_id === p);
    expect(row?.reports).toHaveLength(1);
  });

  it('gives overview numbers and switches the site mode (logged)', async () => {
    const [o] = await db.query<{ o: Record<string, unknown> }>(
      `select public.admin_overview() as o`,
    );
    expect(o!.o).toMatchObject({ mode: 'active' });
    expect(o!.o).toHaveProperty('lostActive');
    await db.query(`select public.admin_set_mode('dormant')`);
    const [mode] = await db.query<{ mode: string }>(`select mode from public.site_settings`);
    expect(mode?.mode).toBe('dormant');
    await db.query(`select public.admin_log('login_ok', '{}')`);
    const log = await db.query<{ action: string }>(`select action from public.admin_audit(5)`);
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['site_mode', 'login_ok']));
  });
});
