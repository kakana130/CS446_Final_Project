import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claims, openTestDb, PERMISSION_DENIED, type TestDb } from './harness';
import { cleanup, ids, seed } from './fixtures';

const ALL_TABLES = [
  'provinces',
  'batches',
  'batch_contacts',
  'push_subscriptions',
  'posts',
  'matches',
  'reports',
  'contact_reveals',
  'feedback',
  'deletion_requests',
  'rate_limits',
  'site_settings',
  'daily_stats',
  'pending_storage_deletes',
  'admin_audit_log',
  'access_log',
] as const;

/** Tables that hold secrets or personal data and must never be readable except by the server. */
const SERVER_ONLY_TABLES = [
  'batches',
  'batch_contacts',
  'push_subscriptions',
  'rate_limits',
  'pending_storage_deletes',
  'access_log',
] as const;

/** Tables an admin at AAL2 may read through RLS. */
const ADMIN_READABLE_TABLES = [
  'provinces',
  'posts',
  'matches',
  'reports',
  'contact_reveals',
  'feedback',
  'deletion_requests',
  'site_settings',
  'daily_stats',
  'admin_audit_log',
] as const;

let db: TestDb;

beforeAll(async () => {
  db = await openTestDb();
  await seed(db);
});

afterAll(async () => {
  await cleanup(db);
  await db.close();
});

describe('schema invariants', () => {
  it('has RLS enabled on every table in public', async () => {
    const rows = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')`,
    );
    const names = rows.map((r) => r.relname).sort();
    expect(names).toEqual([...ALL_TABLES].sort());
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
  });

  it('grants anon no privilege on any public table', async () => {
    const rows = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(rows).toEqual([]);
  });

  it('grants anon/authenticated no EXECUTE on server RPCs', async () => {
    const rows = await db.query<{ fn: string; anon: boolean; authn: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname <> 'is_admin_aal2'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.anon, `anon can execute ${r.fn}`).toBe(false);
      expect(r.authn, `authenticated can execute ${r.fn}`).toBe(false);
    }
  });

  it('pins search_path on every SECURITY DEFINER function', async () => {
    const rows = await db.query<{ fn: string; config: string[] | null }>(
      `select p.proname as fn, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.config ?? [], r.fn).toContain('search_path=""');
  });
});

describe('anon', () => {
  it.each(ALL_TABLES)('cannot select from %s', async (table) => {
    const res = await db.as('anon', claims.anon, `select * from public.${table} limit 1`);
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(ALL_TABLES)('cannot insert into %s', async (table) => {
    const res = await db.as('anon', claims.anon, `insert into public.${table} default values`);
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot call rl_hit', async () => {
    const res = await db.as('anon', claims.anon, `select * from public.rl_hit('x', 'y', 60, 5)`);
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot call plate_candidates', async () => {
    const res = await db.as(
      'anon',
      claims.anon,
      `select * from public.plate_candidates('lost', 'car', 'กข1234', '1234')`,
    );
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot delete or update posts', async () => {
    const del = await db.as('anon', claims.anon, `delete from public.posts`);
    expect(del.error?.code).toBe(PERMISSION_DENIED);
    const upd = await db.as('anon', claims.anon, `update public.posts set status = 'hidden'`);
    expect(upd.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('authenticated non-admin', () => {
  const who = claims.user(ids.user);

  it.each(SERVER_ONLY_TABLES)('cannot select from %s', async (table) => {
    const res = await db.as('authenticated', who, `select * from public.${table} limit 1`);
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });

  it.each(ADMIN_READABLE_TABLES)('sees zero rows in %s', async (table) => {
    const res = await db.as('authenticated', who, `select * from public.${table}`);
    expect(res.error).toBeUndefined();
    expect(res.rows).toEqual([]);
  });

  it('cannot moderate posts', async () => {
    const res = await db.as(
      'authenticated',
      who,
      `update public.posts set status = 'hidden' where id = $1 returning id`,
      [ids.foundPost],
    );
    expect(res.error).toBeUndefined();
    expect(res.rows).toEqual([]);
  });

  it('cannot write the audit log', async () => {
    const res = await db.as(
      'authenticated',
      who,
      `insert into public.admin_audit_log (admin_id, action) values ($1, 'x')`,
      [ids.user],
    );
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('admin without MFA (aal1)', () => {
  const who = claims.adminAal1(ids.admin);

  it('sees zero posts', async () => {
    const res = await db.as('authenticated', who, `select id from public.posts`);
    expect(res.error).toBeUndefined();
    expect(res.rows).toEqual([]);
  });

  it('cannot toggle site mode', async () => {
    const res = await db.as(
      'authenticated',
      who,
      `update public.site_settings set mode = 'dormant', updated_by = $1 returning id`,
      [ids.admin],
    );
    expect(res.rows).toEqual([]);
  });

  it('cannot write the audit log', async () => {
    const res = await db.as(
      'authenticated',
      who,
      `insert into public.admin_audit_log (admin_id, action) values ($1, 'x')`,
      [ids.admin],
    );
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('admin with MFA (aal2)', () => {
  const who = claims.adminAal2(ids.admin);

  it('reads posts and matches', async () => {
    const posts = await db.as('authenticated', who, `select id from public.posts where id = $1`, [
      ids.foundPost,
    ]);
    expect(posts.rows).toHaveLength(1);
    const matches = await db.as(
      'authenticated',
      who,
      `select id from public.matches where id = $1`,
      [ids.match],
    );
    expect(matches.rows).toHaveLength(1);
  });

  it.each(SERVER_ONLY_TABLES)('still cannot read %s', async (table) => {
    const res = await db.as('authenticated', who, `select * from public.${table} limit 1`);
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });

  it('can moderate post status but not edit plate data', async () => {
    const ok = await db.as(
      'authenticated',
      who,
      `update public.posts set status = 'hidden' where id = $1 returning id`,
      [ids.foundPost],
    );
    expect(ok.rows).toHaveLength(1);
    const denied = await db.as(
      'authenticated',
      who,
      `update public.posts set number = '9999' where id = $1`,
      [ids.foundPost],
    );
    expect(denied.error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot delete posts directly (must go through the audited server path)', async () => {
    const res = await db.as('authenticated', who, `delete from public.posts where id = $1`, [
      ids.foundPost,
    ]);
    expect(res.error?.code).toBe(PERMISSION_DENIED);
  });

  it('appends to the audit log only as itself', async () => {
    const ok = await db.as(
      'authenticated',
      who,
      `insert into public.admin_audit_log (admin_id, action) values ($1, 'test') returning id`,
      [ids.admin],
    );
    expect(ok.error).toBeUndefined();
    const spoof = await db.as(
      'authenticated',
      who,
      `insert into public.admin_audit_log (admin_id, action) values ($1, 'test')`,
      [ids.user],
    );
    expect(spoof.error?.code).toBe(PERMISSION_DENIED);
  });

  it('cannot update or delete audit entries', async () => {
    const upd = await db.as('authenticated', who, `update public.admin_audit_log set action = 'x'`);
    expect(upd.error?.code).toBe(PERMISSION_DENIED);
    const del = await db.as('authenticated', who, `delete from public.admin_audit_log`);
    expect(del.error?.code).toBe(PERMISSION_DENIED);
  });

  it('must record itself as updated_by when changing site mode', async () => {
    const ok = await db.as(
      'authenticated',
      who,
      `update public.site_settings set mode = 'dormant', updated_by = $1 returning mode`,
      [ids.admin],
    );
    expect(ok.error).toBeUndefined();
    expect(ok.rows).toEqual([{ mode: 'dormant' }]);
    const spoof = await db.as(
      'authenticated',
      who,
      `update public.site_settings set mode = 'dormant', updated_by = $1`,
      [ids.user],
    );
    expect(spoof.error?.code).toBe(PERMISSION_DENIED);
  });
});

describe('service_role (server)', () => {
  it('reads contacts', async () => {
    const res = await db.as(
      'service_role',
      { role: 'service_role' },
      `select line_id from public.batch_contacts where batch_id = $1`,
      [ids.lostBatch],
    );
    expect(res.rows).toEqual([{ line_id: 'owner.line' }]);
  });

  it('cannot truncate the audit log', async () => {
    const res = await db.as(
      'service_role',
      { role: 'service_role' },
      `truncate public.admin_audit_log`,
    );
    expect(res.error?.message).toMatch(/append-only/);
  });
});

describe('audit log immutability (even for the table owner)', () => {
  it('rejects update and delete of existing rows', async () => {
    await db.exec('begin');
    try {
      await db.query(`insert into public.admin_audit_log (admin_id, action) values ($1, 'probe')`, [
        ids.admin,
      ]);
      await expect(db.query(`update public.admin_audit_log set action = 'x'`)).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await db.exec('rollback');
    }
    await db.exec('begin');
    try {
      await db.query(`insert into public.admin_audit_log (admin_id, action) values ($1, 'probe')`, [
        ids.admin,
      ]);
      await expect(db.query(`delete from public.admin_audit_log`)).rejects.toThrow(/append-only/);
    } finally {
      await db.exec('rollback');
    }
  });
});

describe('storage', () => {
  it('keeps the crops bucket private and webp-only', async () => {
    const rows = await db.query<{ public: boolean; allowed_mime_types: string[] }>(
      `select public, allowed_mime_types from storage.buckets where id = 'crops'`,
    );
    expect(rows).toEqual([{ public: false, allowed_mime_types: ['image/webp'] }]);
  });
});
