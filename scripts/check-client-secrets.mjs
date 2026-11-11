// Fails if anything secret reaches files that are served to browsers.
//
// Scans .next/static/** (client JS/CSS) and the HTML/RSC payloads under .next/server/app/**
// for: server-only env var NAMES, the exact VALUES of those vars (CI builds with unique canary
// values), Supabase secret-key prefixes, and legacy JWTs whose payload role is service_role.
//
// Usage: node scripts/check-client-secrets.mjs [buildDir]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECRET_ENV_NAMES = [
  'DATABASE_URL',
  'COGNITO_CLIENT_SECRET',
  'AUTH_SESSION_SECRET',
  'ADMIN_SESSION_SECRET',
  'TURNSTILE_SECRET_KEY',
  'VAPID_PRIVATE_KEY',
  'CRON_SECRET',
  'IP_HASH_SECRET',
  'ACCESS_LOG_KEY',
];

const CLIENT_EXT = /\.(js|mjs|css|html|rsc|body|json|txt|map)$/;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** Files that are delivered to the browser. */
export function clientFiles(buildDir) {
  const files = [...walk(join(buildDir, 'static'))];
  for (const f of walk(join(buildDir, 'server', 'app'))) {
    if (/\.(html|rsc|body)$/.test(f)) files.push(f);
  }
  return files.filter((f) => CLIENT_EXT.test(f));
}

function isServiceRoleJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export function scanContent(content, env = process.env) {
  const findings = [];
  for (const name of SECRET_ENV_NAMES) {
    if (content.includes(name)) findings.push(`env var name ${name}`);
    const value = env[name];
    if (value && value.length >= 8 && content.includes(value)) findings.push(`value of ${name}`);
  }
  if (content.includes('sb_secret_')) findings.push('Supabase secret key prefix (sb_secret_)');
  for (const token of content.match(JWT) ?? []) {
    if (isServiceRoleJwt(token)) findings.push('legacy service_role JWT');
  }
  return findings;
}

export function scanBuild(buildDir, env = process.env) {
  const files = clientFiles(buildDir);
  const results = [];
  for (const file of files) {
    const findings = scanContent(readFileSync(file, 'utf8'), env);
    if (findings.length) results.push({ file: relative(buildDir, file), findings });
  }
  return { scanned: files.length, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const buildDir = process.argv[2] ?? '.next';
  const { scanned, results } = scanBuild(buildDir);
  if (scanned === 0) {
    console.error(`No client files found under ${buildDir}. Run \`npm run build\` first.`);
    process.exit(2);
  }
  if (results.length) {
    console.error('SECRET LEAK in client bundle:');
    for (const r of results) console.error(`  ${r.file}: ${[...new Set(r.findings)].join(', ')}`);
    process.exit(1);
  }
  console.log(`No secrets found in ${scanned} client files.`);
}
