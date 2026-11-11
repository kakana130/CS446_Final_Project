#!/usr/bin/env node
/**
 * Apply the database schema to Amazon RDS for PostgreSQL (or any Postgres):
 *   1. aws/db/platform-shim.sql (roles and schemas the migrations expect),
 *   2. every supabase/migrations/*.sql not applied yet, in order, each in a transaction.
 * Applied files are recorded in public.schema_migrations, so running it again is safe.
 *
 *   npm run db:migrate            (reads DATABASE_URL, DATABASE_SSL, DATABASE_CA_FILE from
 *                                  the environment or .env.local / .env)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['.env.local', '.env']) {
  const path = join(ROOT, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const mode = process.env.DATABASE_SSL ?? 'verify';
const ssl =
  mode === 'off'
    ? false
    : mode === 'require'
      ? { rejectUnauthorized: false }
      : process.env.DATABASE_CA_FILE
        ? { ca: readFileSync(process.env.DATABASE_CA_FILE, 'utf8'), rejectUnauthorized: true }
        : { rejectUnauthorized: true };

const client = new pg.Client({ connectionString: url, ssl });
await client.connect();

try {
  await client.query(`create table if not exists public.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  // Not exposed to the API roles the migrations know about.
  await client.query('revoke all on public.schema_migrations from public');
  const done = new Set(
    (await client.query('select name from public.schema_migrations')).rows.map((r) => r.name),
  );

  const files = [
    ['aws/db/platform-shim.sql', join(ROOT, 'aws', 'db', 'platform-shim.sql')],
    ...readdirSync(join(ROOT, 'supabase', 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => [f, join(ROOT, 'supabase', 'migrations', f)]),
  ];

  let applied = 0;
  for (const [name, path] of files) {
    if (done.has(name)) continue;
    process.stdout.write(`applying ${name} ... `);
    await client.query('begin');
    try {
      await client.query(readFileSync(path, 'utf8'));
      await client.query('insert into public.schema_migrations (name) values ($1)', [name]);
      await client.query('commit');
      applied += 1;
      console.log('ok');
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      throw err;
    }
  }
  console.log(applied ? `Applied ${applied} file(s).` : 'Database is up to date.');
} finally {
  await client.end();
}
