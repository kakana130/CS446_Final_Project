import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { scanBuild, scanContent } from './check-client-secrets.mjs';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: object) =>
  `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJlc2lnbmF0dXJl`;

describe('scanContent', () => {
  it('flags server env var names', () => {
    expect(scanContent('const k = process.env.DATABASE_URL', {})).toContain(
      'env var name DATABASE_URL',
    );
  });

  it('flags the exact value of a secret (canary)', () => {
    const env = { CRON_SECRET: 'canary-cron-7f3a9c' };
    expect(scanContent('x="canary-cron-7f3a9c"', env)).toContain('value of CRON_SECRET');
  });

  it('flags new-format Supabase secret keys', () => {
    expect(scanContent('"sb_secret_abc123"', {})).toHaveLength(1);
  });

  it('flags legacy service_role JWTs but not anon JWTs', () => {
    expect(scanContent(jwt({ role: 'service_role', iss: 'supabase' }), {})).toContain(
      'legacy service_role JWT',
    );
    expect(scanContent(jwt({ role: 'anon', iss: 'supabase' }), {})).toEqual([]);
  });

  it('allows public values', () => {
    expect(scanContent('NEXT_PUBLIC_TURNSTILE_SITE_KEY NEXT_PUBLIC_FEATURE_ALERTS', {})).toEqual(
      [],
    );
  });
});

describe('scanBuild', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2h-scan-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('scans client assets and prerendered payloads, not server bundles', () => {
    mkdirSync(join(dir, 'static', 'chunks'), { recursive: true });
    mkdirSync(join(dir, 'server', 'app'), { recursive: true });
    writeFileSync(join(dir, 'static', 'chunks', 'ok.js'), 'console.log(1)');
    writeFileSync(join(dir, 'static', 'chunks', 'leak.js'), 'fetch(x,{h:"sb_secret_zzz"})');
    writeFileSync(join(dir, 'server', 'app', 'index.html'), '<p>IP_HASH_SECRET</p>');
    // Server-side code legitimately references secret names and must not be flagged.
    writeFileSync(join(dir, 'server', 'app', 'page.js'), 'process.env.DATABASE_URL');

    const { scanned, results } = scanBuild(dir, {});
    expect(scanned).toBe(3);
    expect(results.map((r: { file: string }) => r.file.replaceAll('\\', '/')).sort()).toEqual([
      'server/app/index.html',
      'static/chunks/leak.js',
    ]);
  });
});
