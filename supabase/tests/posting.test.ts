import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, type TestDb } from './harness';
import { HEX64 } from './fixtures';

let db: TestDb;
const created: string[] = [];
const HEX64_B = 'b'.repeat(64);

const lostArgs = (letters: string, number: string, province: string | null = 'TH-10') => [
  null,
  HEX64,
  'th',
  'v1',
  'owner.line',
  null,
  null,
  false,
  false,
  'car',
  null,
  letters,
  number,
  province,
  `car||${letters}|${number}|${province ?? ''}`,
  `${letters}${number}`,
  `${letters} ${number}`,
  false,
  'valid',
];

async function createLost(letters = 'กข', number = '1234', province: string | null = 'TH-10') {
  const [row] = await db.query<{ out_batch_id: string; out_post_id: string }>(
    `select * from public.create_lost_watch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    lostArgs(letters, number, province),
  );
  created.push(row!.out_batch_id);
  return row!;
}

async function createFoundBatch(expiresInSeconds = 1800) {
  const [row] = await db.query<{ id: string }>(
    `select public.create_found_batch($1,$2,$3, now() + make_interval(secs => $4), 'th', 'v1',
                                      'with_finder', null, null, 'finder.line', null, null, false) as id`,
    [null, HEX64, HEX64_B, expiresInSeconds],
  );
  created.push(row!.id);
  return row!.id;
}

let postSeq = 0;
function addFound(batchId: string, opts: { token?: string; letters?: string; max?: number } = {}) {
  postSeq += 1;
  const postId = `00000000-0000-4000-9000-${String(postSeq).padStart(12, '0')}`;
  const letters = opts.letters ?? 'กข';
  return db.query<{ id: string }>(
    `select public.add_found_plate($1,$2,$3,'car',null,$4,'1234','TH-10',$5,$6,$7,false,'valid',
                                   $8,'active','{}',null,$9) as id`,
    [
      batchId,
      opts.token ?? HEX64_B,
      postId,
      letters,
      `car||${letters}|1234|TH-10`,
      `${letters}1234`,
      `${letters} 1234`,
      `${batchId}/${postId}.webp`,
      opts.max ?? 20,
    ],
  );
}

beforeAll(async () => {
  db = await openTestDb();
});

beforeEach(async () => {
  await db.query(`delete from public.daily_stats`);
});

afterAll(async () => {
  if (created.length) {
    await db.query(`delete from public.batches where id = any($1::uuid[])`, [created]);
  }
  await db.query(`delete from public.pending_storage_deletes where path like '%'`);
  await db.close();
});

const stat = async (field: string) =>
  Number(
    (
      await db.query<Record<string, number>>(
        `select coalesce(sum(${field}), 0) as n from public.daily_stats`,
      )
    )[0]?.n ?? 0,
  );

describe('create_lost_watch', () => {
  it('creates batch, contact and post atomically and counts it', async () => {
    const { out_batch_id, out_post_id } = await createLost('ขค', '777');
    const [post] = await db.query<{ kind: string; batch_id: string; expires_at: Date }>(
      `select kind, batch_id, expires_at from public.posts where id = $1`,
      [out_post_id],
    );
    expect(post).toMatchObject({ kind: 'lost', batch_id: out_batch_id });
    const [contact] = await db.query<{ line_id: string }>(
      `select line_id from public.batch_contacts where batch_id = $1`,
      [out_batch_id],
    );
    expect(contact?.line_id).toBe('owner.line');
    expect(await stat('lost_created')).toBe(1);
  });

  it('rolls everything back when any insert fails', async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int as n from public.batches`);
    const args = lostArgs('กข', '1234');
    args[4] = null; // no LINE, no phone, no visible email → contact CHECK fails
    await expect(
      db.query(
        `select * from public.create_lost_watch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        args,
      ),
    ).rejects.toThrow();
    const after = await db.query<{ n: number }>(`select count(*)::int as n from public.batches`);
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('found batch and plates', () => {
  it('adds plates with a valid upload token', async () => {
    const batch = await createFoundBatch();
    const [ok] = await db.query<{ ok: boolean }>(`select public.check_upload_token($1, $2) as ok`, [
      batch,
      HEX64_B,
    ]);
    expect(ok?.ok).toBe(true);
    await expect(addFound(batch)).resolves.toHaveLength(1);
    expect(await stat('found_created')).toBe(1);
  });

  it('rejects a wrong upload token', async () => {
    const batch = await createFoundBatch();
    await expect(addFound(batch, { token: 'c'.repeat(64) })).rejects.toThrow(
      /upload_token_invalid/,
    );
    const [ok] = await db.query<{ ok: boolean }>(`select public.check_upload_token($1, $2) as ok`, [
      batch,
      'c'.repeat(64),
    ]);
    expect(ok?.ok).toBe(false);
  });

  it('rejects an expired upload token', async () => {
    const batch = await createFoundBatch(-1);
    await expect(addFound(batch)).rejects.toThrow(/upload_token_invalid/);
  });

  it('caps the number of plates per batch', async () => {
    const batch = await createFoundBatch();
    await addFound(batch, { max: 2 });
    await addFound(batch, { max: 2 });
    await expect(addFound(batch, { max: 2 })).rejects.toThrow(/batch_full/);
  });

  it('refuses to add a found plate to a lost batch', async () => {
    const { out_batch_id } = await createLost();
    await expect(addFound(out_batch_id)).rejects.toThrow(/upload_token_invalid/);
  });
});

describe('record_matches and get_match_view', () => {
  it('records a match once, reports it as new only the first time, and counts it', async () => {
    const lost = await createLost('ฉช', '4321');
    const batch = await createFoundBatch();
    const [found] = await addFound(batch, { letters: 'ฉช' });
    const payload = JSON.stringify([
      { lost_post_id: lost.out_post_id, found_post_id: found!.id, score: 0.9, kind: 'near' },
    ]);

    const first = await db.query<{ out_is_new: boolean; out_kind: string; out_match_id: string }>(
      `select * from public.record_matches($1::jsonb)`,
      [payload],
    );
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ out_is_new: true, out_kind: 'near' });

    const upgraded = JSON.stringify([
      { lost_post_id: lost.out_post_id, found_post_id: found!.id, score: 1, kind: 'exact' },
    ]);
    const second = await db.query<{ out_is_new: boolean; out_kind: string; out_match_id: string }>(
      `select * from public.record_matches($1::jsonb)`,
      [upgraded],
    );
    expect(second[0]).toMatchObject({ out_is_new: false, out_kind: 'exact' });
    expect(second[0]?.out_match_id).toBe(first[0]?.out_match_id);
    expect(await stat('matches')).toBe(1);

    const [view] = await db.query<Record<string, unknown>>(
      `select * from public.get_match_view($1)`,
      [first[0]!.out_match_id],
    );
    expect(view).toMatchObject({
      match_kind: 'exact',
      lost_letters: 'ฉช',
      found_letters: 'ฉช',
      found_handover: 'with_finder',
    });
    expect(view).not.toHaveProperty('line_id');
  });

  it('hides the match view when the found post is not active', async () => {
    const lost = await createLost('ญฎ', '55');
    const batch = await createFoundBatch();
    const [found] = await addFound(batch, { letters: 'ญฎ' });
    const [m] = await db.query<{ out_match_id: string }>(
      `select * from public.record_matches($1::jsonb)`,
      [
        JSON.stringify([
          { lost_post_id: lost.out_post_id, found_post_id: found!.id, score: 1, kind: 'exact' },
        ]),
      ],
    );
    await db.query(`update public.posts set status = 'hidden' where id = $1`, [found!.id]);
    const rows = await db.query(`select * from public.get_match_view($1)`, [m!.out_match_id]);
    expect(rows).toEqual([]);
  });
});

describe('plate_candidates', () => {
  it('returns found posts for a lost query, with the fields search needs', async () => {
    const batch = await createFoundBatch();
    await addFound(batch, { letters: 'ฐฑ' });
    const rows = await db.query<{ kind: string; crop_path: string; format_status: string }>(
      `select * from public.plate_candidates('lost', 'car', 'ฐฑ1234', '1234')`,
    );
    const hit = rows.find((r) => r.crop_path?.startsWith(batch));
    expect(hit).toMatchObject({ kind: 'found', format_status: 'valid' });
  });

  it('skips expired posts', async () => {
    const batch = await createFoundBatch();
    const [found] = await addFound(batch, { letters: 'ฒณ' });
    await db.query(`update public.posts set expires_at = now() - interval '1 day' where id = $1`, [
      found!.id,
    ]);
    const rows = await db.query<{ id: string }>(
      `select id from public.plate_candidates('lost', 'car', 'ฒณ1234', '1234')`,
    );
    expect(rows.map((r) => r.id)).not.toContain(found!.id);
  });
});

describe('get_found_post and reveal_found_contact', () => {
  it('shows a found post without contact details, and reveals the contact with a log entry', async () => {
    const batch = await createFoundBatch();
    const [found] = await addFound(batch, { letters: 'ถท' });
    const [post] = await db.query<Record<string, unknown>>(
      `select * from public.get_found_post($1)`,
      [found!.id],
    );
    expect(post).toMatchObject({ letters: 'ถท', handover: 'with_finder' });
    expect(post).not.toHaveProperty('line_id');
    expect(post).not.toHaveProperty('district');

    const ipHash = 'e'.repeat(64);
    const [contact] = await db.query<Record<string, unknown>>(
      `select * from public.reveal_found_contact($1, $2)`,
      [found!.id, ipHash],
    );
    expect(contact).toMatchObject({ line_id: 'finder.line', email: null, handover: 'with_finder' });
    const logged = await db.query(
      `select 1 from public.contact_reveals where post_id = $1 and ip_hash = $2`,
      [found!.id, ipHash],
    );
    expect(logged).toHaveLength(1);
  });

  it('reveals nothing (and logs nothing) for lost watches or hidden posts', async () => {
    const { out_post_id } = await createLost('ธน', '31');
    expect(
      await db.query(`select * from public.reveal_found_contact($1, $2)`, [
        out_post_id,
        'e'.repeat(64),
      ]),
    ).toEqual([]);
    expect(await db.query(`select * from public.get_found_post($1)`, [out_post_id])).toEqual([]);

    const batch = await createFoundBatch();
    const [found] = await addFound(batch, { letters: 'นบ' });
    await db.query(`update public.posts set status = 'hidden' where id = $1`, [found!.id]);
    expect(
      await db.query(`select * from public.reveal_found_contact($1, $2)`, [
        found!.id,
        'e'.repeat(64),
      ]),
    ).toEqual([]);
    expect(
      await db.query(`select 1 from public.contact_reveals where post_id = $1`, [found!.id]),
    ).toEqual([]);
  });
});

describe('notes (หมายเหตุ)', () => {
  it("shows the owner's note on the match view and the finder's note only with the reveal", async () => {
    const args = [...lostArgs('ปผ', '808'), 'ป้ายหลัง มีสติกเกอร์'];
    const [lost] = await db.query<{ out_batch_id: string; out_post_id: string }>(
      `select * from public.create_lost_watch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      args,
    );
    created.push(lost!.out_batch_id);

    const [fb] = await db.query<{ id: string }>(
      `select public.create_found_batch($1,$2,$3, now() + interval '30 minutes', 'th', 'v1',
                                        'with_finder', null, null, 'finder.line', null, null, false,
                                        'เจอใกล้วัด ทั้งป้ายหน้าและหลัง') as id`,
      [null, HEX64, HEX64_B],
    );
    created.push(fb!.id);
    const [found] = await addFound(fb!.id, { letters: 'ปผ' });
    const [m] = await db.query<{ out_match_id: string }>(
      `select * from public.record_matches($1::jsonb)`,
      [
        JSON.stringify([
          { lost_post_id: lost!.out_post_id, found_post_id: found!.id, score: 1, kind: 'near' },
        ]),
      ],
    );

    const [view] = await db.query<Record<string, unknown>>(
      `select * from public.get_match_view($1)`,
      [m!.out_match_id],
    );
    expect(view?.lost_note).toBe('ป้ายหลัง มีสติกเกอร์');
    expect(JSON.stringify(view)).not.toContain('เจอใกล้วัด');

    const [post] = await db.query<Record<string, unknown>>(
      `select * from public.get_found_post($1)`,
      [found!.id],
    );
    expect(JSON.stringify(post)).not.toContain('เจอใกล้วัด');

    const [contact] = await db.query<Record<string, unknown>>(
      `select * from public.reveal_found_contact($1, $2)`,
      [found!.id, 'f'.repeat(64)],
    );
    expect(contact?.note).toBe('เจอใกล้วัด ทั้งป้ายหน้าและหลัง');
  });

  it('stores an empty note as null and rejects notes over 300 characters', async () => {
    const [lost] = await db.query<{ out_batch_id: string }>(
      `select * from public.create_lost_watch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [...lostArgs('ฝพ', '9'), ''],
    );
    created.push(lost!.out_batch_id);
    const [row] = await db.query<{ note: string | null }>(
      `select note from public.batches where id = $1`,
      [lost!.out_batch_id],
    );
    expect(row?.note).toBeNull();
    await expect(
      db.query(
        `select * from public.create_lost_watch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [...lostArgs('ฝพ', '10'), 'ก'.repeat(301)],
      ),
    ).rejects.toThrow();
  });
});

describe('my_posts and reveal_owner_contact', () => {
  async function matchedPair(letters: string) {
    const lost = await createLost(letters, '4242');
    const batch = await createFoundBatch();
    const [found] = await addFound(batch, { letters });
    const [m] = await db.query<{ out_match_id: string }>(
      `select * from public.record_matches($1::jsonb)`,
      [
        JSON.stringify([
          { lost_post_id: lost.out_post_id, found_post_id: found!.id, score: 1, kind: 'exact' },
        ]),
      ],
    );
    return { lost, foundBatch: batch, foundPost: found!.id, matchId: m!.out_match_id };
  }

  it('lists only posts whose device token matches, with their active matches', async () => {
    const { lost, matchId } = await matchedPair('มย');
    const mine = await db.query<{ post_id: string; kind: string; matches: { matchId: string }[] }>(
      `select * from public.my_posts($1::uuid[], $2::text[])`,
      [[lost.out_batch_id], [HEX64]],
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ post_id: lost.out_post_id, kind: 'lost' });
    expect(mine[0]!.matches.map((m) => m.matchId)).toEqual([matchId]);

    const wrongToken = await db.query(`select * from public.my_posts($1::uuid[], $2::text[])`, [
      [lost.out_batch_id],
      ['0'.repeat(64)],
    ]);
    expect(wrongToken).toEqual([]);
  });

  it("lets the matched finder (device token) see the owner's contact, and logs it", async () => {
    const { lost, matchId } = await matchedPair('รล');
    const [contact] = await db.query<{ line_id: string }>(
      `select * from public.reveal_owner_contact($1, $2, $3)`,
      [matchId, HEX64, 'd'.repeat(64)],
    );
    expect(contact?.line_id).toBe('owner.line');
    const logged = await db.query(
      `select 1 from public.contact_reveals where post_id = $1 and match_id = $2`,
      [lost.out_post_id, matchId],
    );
    expect(logged).toHaveLength(1);
  });

  it("refuses the owner's contact without the finder's device token", async () => {
    const { matchId } = await matchedPair('วศ');
    const rows = await db.query(`select * from public.reveal_owner_contact($1, $2, $3)`, [
      matchId,
      '1'.repeat(64),
      'd'.repeat(64),
    ]);
    expect(rows).toEqual([]);
  });

  it('returns both batch ids in the match view (for role detection)', async () => {
    const { lost, foundBatch, matchId } = await matchedPair('สห');
    const [view] = await db.query<{ lost_batch_id: string; found_batch_id: string }>(
      `select * from public.get_match_view($1)`,
      [matchId],
    );
    expect(view).toMatchObject({ lost_batch_id: lost.out_batch_id, found_batch_id: foundBatch });
  });
});
