/**
 * Database test harness.
 *
 * Backends:
 *  - DATABASE_URL set  → real Postgres (e.g. `supabase start`, migrations already applied).
 *  - otherwise         → in-process PGlite with a Supabase shim + all migrations applied.
 *
 * `as()` runs a single statement as a given role with given JWT claims inside a transaction
 * that is always rolled back, mirroring how PostgREST executes requests.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export type DbRole = 'anon' | 'authenticated' | 'service_role';

export interface Result<T = Record<string, unknown>> {
  rows: T[];
  error?: { message: string; code?: string };
}

export interface TestDb {
  backend: 'pglite' | 'postgres';
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  as<T = Record<string, unknown>>(
    role: DbRole,
    claims: Record<string, unknown> | null,
    sql: string,
    params?: unknown[],
  ): Promise<Result<T>>;
  close(): Promise<void>;
}

const SUPABASE_DIR = join(HERE, '..');

function migrationFiles(): string[] {
  const dir = join(SUPABASE_DIR, 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
}

interface Driver {
  exec(sql: string): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  close(): Promise<void>;
}

async function pgliteDriver(): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const db = await PGlite.create({ extensions: { pg_trgm } });
  await db.exec(readFileSync(join(HERE, 'shim.sql'), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`migration failed: ${file}: ${(e as Error).message}`);
    }
  }
  return {
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: (sql, params) => db.query(sql, params),
    close: () => db.close(),
  };
}

async function postgresDriver(url: string): Promise<Driver> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    exec: async (sql) => {
      await client.query(sql);
    },
    query: (sql, params) => client.query(sql, params as unknown[]),
    close: () => client.end(),
  };
}

export async function openTestDb(): Promise<TestDb> {
  const url = process.env.DATABASE_URL;
  const driver = url ? await postgresDriver(url) : await pgliteDriver();

  const toError = (e: unknown) => {
    const err = e as { message?: string; code?: string };
    return { message: err.message ?? String(e), code: err.code };
  };

  return {
    backend: url ? 'postgres' : 'pglite',
    exec: (sql) => driver.exec(sql),
    query: async <T>(sql: string, params?: unknown[]) =>
      (await driver.query(sql, params)).rows as T[],
    as: async <T>(
      role: DbRole,
      claims: Record<string, unknown> | null,
      sql: string,
      params?: unknown[],
    ): Promise<Result<T>> => {
      await driver.exec('begin');
      try {
        await driver.exec(`set local role ${role}`);
        await driver.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify(claims ?? { role }),
        ]);
        const res = await driver.query(sql, params);
        return { rows: res.rows as T[] };
      } catch (e) {
        return { rows: [], error: toError(e) };
      } finally {
        await driver.exec('rollback');
      }
    },
    close: () => driver.close(),
  };
}

/** JWT claim sets used across tests. */
export const claims = {
  anon: { role: 'anon' },
  user: (sub: string) => ({ role: 'authenticated', sub, aal: 'aal2', app_metadata: {} }),
  adminAal1: (sub: string) => ({
    role: 'authenticated',
    sub,
    aal: 'aal1',
    app_metadata: { role: 'admin' },
  }),
  adminAal2: (sub: string) => ({
    role: 'authenticated',
    sub,
    aal: 'aal2',
    app_metadata: { role: 'admin' },
  }),
};

export const PERMISSION_DENIED = '42501';
