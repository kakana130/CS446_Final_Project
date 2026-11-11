import 'server-only';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { requireEnv, serverEnv } from '@/lib/env/server';

/**
 * The only place the database connection is made (Amazon RDS for PostgreSQL). The app
 * connects as the database owner, so:
 *  - this module is `server-only` (importing it from a client component fails the build);
 *  - ESLint forbids importing it from anywhere except lib/db/**, where narrow, named
 *    data-access functions return only safe columns.
 *
 * Almost all data access goes through the SQL functions in supabase/migrations. `rpc()` calls
 * them the way PostgREST used to (named arguments, same result shapes), so lib/db/* only had
 * to swap the client.
 */

// Results in the shapes PostgREST returned: timestamps as ISO strings, bigint/numeric as numbers.
const { types } = pg;
const isoTimestamp = (v: string) => {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2})(?::?(\d{2}))?$/.exec(v);
  return m ? `${m[1]}T${m[2]}${m[3] ?? ''}${m[4]}:${m[5] ?? '00'}` : v;
};
types.setTypeParser(types.builtins.TIMESTAMPTZ, isoTimestamp);
types.setTypeParser(types.builtins.TIMESTAMP, (v) => v.replace(' ', 'T'));
types.setTypeParser(types.builtins.DATE, (v) => v);
types.setTypeParser(types.builtins.INT8, (v) => Number(v));
types.setTypeParser(types.builtins.NUMERIC, (v) => Number(v));

let pool: pg.Pool | undefined;

function sslConfig(): pg.PoolConfig['ssl'] {
  const env = serverEnv();
  switch (env.DATABASE_SSL) {
    case 'off':
      return false;
    case 'require':
      return { rejectUnauthorized: false };
    default:
      // 'verify': the RDS certificate bundle (https://truststore.pki.rds.amazonaws.com).
      return env.DATABASE_CA_FILE
        ? { ca: readFileSync(env.DATABASE_CA_FILE, 'utf8'), rejectUnauthorized: true }
        : { rejectUnauthorized: true };
  }
}

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requireEnv('DATABASE_URL'),
      ssl: sslConfig(),
      max: serverEnv().DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      application_name: 'plate2home',
      options: '-c TimeZone=UTC',
    });
    pool.on('error', (err) => console.error('[db] idle client error', err.name));
  }
  return pool;
}

/** A Postgres error, reduced to what toDbError needs (SQLSTATE code and message). */
export interface PgError {
  code?: string;
  message?: string;
}

export type Result<T> = { data: T; error: null } | { data: null; error: PgError };

function asPgError(err: unknown): PgError {
  const e = err as { code?: unknown; message?: unknown };
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
  };
}

/** Plain SQL with positional parameters; rows come back with the parsers above. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<Result<T[]>> {
  try {
    const res = await db().query(sql, params);
    return { data: res.rows as T[], error: null };
  } catch (err) {
    return { data: null, error: asPgError(err) };
  }
}

interface FnInfo {
  /** Input argument name → SQL type. */
  args: Map<string, string>;
  retset: boolean;
  rettype: string;
  /** Has OUT/TABLE columns: results are rows, not a single value. */
  rows: boolean;
}

const fnCache = new Map<string, FnInfo[]>();

async function describe(fn: string): Promise<FnInfo[]> {
  const cached = fnCache.get(fn);
  if (cached) return cached;
  const res = await db().query<{
    retset: boolean;
    rettype: string;
    names: string[] | null;
    modes: string[] | null;
    types: string[];
  }>(
    `select p.proretset as retset,
            format_type(p.prorettype, null) as rettype,
            p.proargnames as names,
            p.proargmodes::text[] as modes,
            array(select format_type(t, null)
                  from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]))
                       with ordinality u(t, i) order by i) as types
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [fn],
  );
  const infos = res.rows.map((r) => {
    const args = new Map<string, string>();
    let rows = false;
    r.types.forEach((type, i) => {
      const mode = r.modes?.[i] ?? 'i';
      if (mode === 'i' || mode === 'b') args.set(r.names?.[i] ?? `$${i + 1}`, type);
      if (mode === 'o' || mode === 'b' || mode === 't') rows = true;
    });
    return { args, retset: r.retset, rettype: r.rettype, rows };
  });
  fnCache.set(fn, infos);
  return infos;
}

/**
 * Call `public.<fn>(name => value, ...)` like PostgREST's `rpc()`:
 *  - TABLE/OUT functions return an array of rows (one object for a non-set function);
 *  - `setof scalar` returns an array of values; a scalar returns the value; void returns null.
 * json/jsonb arguments are sent as JSON text; arrays as Postgres arrays.
 */
export async function rpc<T = unknown>(
  fn: string,
  params: Record<string, unknown> = {},
): Promise<Result<T>> {
  try {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw Object.assign(new Error('bad_fn'), { code: '42883' });
    const given = Object.keys(params).filter((k) => params[k] !== undefined);
    const info = (await describe(fn)).find((f) => given.every((k) => f.args.has(k)));
    if (!info) throw Object.assign(new Error(`function ${fn} not found`), { code: '42883' });

    const values: unknown[] = [];
    const named = given.map((name, i) => {
      const type = info.args.get(name)!;
      const value = params[name];
      const json = type === 'json' || type === 'jsonb';
      values.push(json && value !== null ? JSON.stringify(value) : value);
      return `${name} => $${i + 1}::${type}`;
    });
    const res = await db().query(`select * from public.${fn}(${named.join(', ')})`, values);

    let data: unknown;
    if (info.rows) data = info.retset ? res.rows : (res.rows[0] ?? null);
    else if (info.retset) data = res.rows.map((r: Record<string, unknown>) => r[fn]);
    else
      data =
        info.rettype === 'void' ? null : ((res.rows[0] as Record<string, unknown>)?.[fn] ?? null);
    return { data: data as T, error: null };
  } catch (err) {
    return { data: null, error: asPgError(err) };
  }
}
