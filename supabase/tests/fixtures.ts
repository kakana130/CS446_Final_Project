import type { TestDb } from './harness';

// Fixed ids so tests can be re-run against a persistent database and cleaned up.
export const ids = {
  lostBatch: '00000000-0000-4000-8000-00000000b001',
  foundBatch: '00000000-0000-4000-8000-00000000b002',
  lostPost: '00000000-0000-4000-8000-00000000a001',
  foundPost: '00000000-0000-4000-8000-00000000a002',
  match: '00000000-0000-4000-8000-00000000c001',
  admin: '00000000-0000-4000-8000-0000000000ad',
  user: '00000000-0000-4000-8000-0000000000e1',
};

export const HEX64 = 'a'.repeat(64);

export async function cleanup(db: TestDb) {
  await db.query(`delete from public.batches where id = any($1::uuid[])`, [
    [ids.lostBatch, ids.foundBatch],
  ]);
  await db.query(`delete from public.pending_storage_deletes where path like $1`, [
    `${ids.foundBatch}/%`,
  ]);
  await db.query(`delete from public.rate_limits where bucket like 'test:%'`);
  await db.query(`update public.site_settings set mode = 'active', updated_by = null`);
  await db.query(`delete from auth.users where id = any($1::uuid[])`, [[ids.admin, ids.user]]);
}

/** A lost watch and a found post for กข 1234 Bangkok, matched to each other. */
export async function seed(db: TestDb) {
  await cleanup(db);
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [ids.admin, ids.user]);
  await db.query(
    `insert into public.batches (id, kind, device_token_hash, locale, consent_version)
     values ($1, 'lost', $3, 'th', 'v1'),
            ($2, 'found', $3, 'th', 'v1')`,
    [ids.lostBatch, ids.foundBatch, HEX64],
  );
  await db.query(
    `insert into public.batch_contacts (batch_id, line_id, phone)
     values ($1, 'owner.line', '0812345678'), ($2, 'finder.line', null)`,
    [ids.lostBatch, ids.foundBatch],
  );
  await db.query(
    `insert into public.push_subscriptions (batch_id, endpoint, p256dh, auth)
     values ($1, 'https://push.example.test/abc', 'key', 'auth')`,
    [ids.lostBatch],
  );
  await db.query(
    `insert into public.posts (id, batch_id, kind, plate_type, letters, number, province_code,
                               plate_canonical, plate_key, plate_display, format_status, crop_path)
     values ($1, $2, 'lost', 'car', 'กข', '1234', 'TH-10', 'car||กข|1234|TH-10', 'กข1234',
             'กข 1234 กรุงเทพมหานคร', 'valid', null),
            ($3, $4, 'found', 'car', 'กข', '1234', 'TH-10', 'car||กข|1234|TH-10', 'กข1234',
             'กข 1234 กรุงเทพมหานคร', 'valid', $5)`,
    [
      ids.lostPost,
      ids.lostBatch,
      ids.foundPost,
      ids.foundBatch,
      `${ids.foundBatch}/${ids.foundPost}.webp`,
    ],
  );
  await db.query(
    `insert into public.matches (id, lost_post_id, found_post_id, score, kind)
     values ($1, $2, $3, 1, 'exact')`,
    [ids.match, ids.lostPost, ids.foundPost],
  );
}
