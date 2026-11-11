#!/usr/bin/env node
/**
 * A throwaway local PostgreSQL for development, no install or Docker needed: PGlite (real
 * Postgres compiled to WebAssembly, with pg_trgm) behind a normal TCP port. Data lives in
 * memory and is gone when you stop it (Ctrl+C).
 *
 *   npm run db:local          then, in another terminal:
 *   npm run db:migrate        with DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
 *                             and DATABASE_SSL=off DATABASE_POOL_MAX=1 in .env.local
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.DB_LOCAL_PORT ?? 5433);
const db = await PGlite.create({ extensions: { pg_trgm } });
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log(`Local Postgres ready: postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);
console.log('It accepts one connection at a time: set DATABASE_POOL_MAX=1. Ctrl+C to stop.');

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
