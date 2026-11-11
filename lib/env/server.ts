import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated once. Every variable is documented in .env.example.
 * Most are optional at boot so the app can run partially configured in development; code
 * that needs one calls `requireEnv()`, which fails loudly with the variable's name.
 */

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const secret = z.string().min(16);

const schema = z.object({
  APP_ORIGIN: z.url().optional(),

  // Amazon RDS for PostgreSQL (lib/db/server.ts).
  DATABASE_URL: z.string().startsWith('postgres').optional(),
  DATABASE_SSL: z.enum(['verify', 'require', 'off']).default('verify'),
  DATABASE_CA_FILE: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  // AWS (credentials come from the EC2 instance role, never from env).
  AWS_REGION: z.string().min(1).optional(),
  // Amazon S3 bucket for plate crops (lib/db/storage.ts).
  S3_BUCKET: z.string().min(3).optional(),
  // AWS Lambda function that talks to Amazon SNS for match alerts (lib/notify).
  NOTIFY_LAMBDA_NAME: z.string().min(1).optional(),

  // Amazon Cognito for optional sign-in (lib/auth/session.ts).
  COGNITO_USER_POOL_ID: z
    .string()
    .regex(/^[\w-]+_[0-9a-zA-Z]+$/)
    .optional(),
  COGNITO_DOMAIN: z.url().optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_SECRET: z.string().min(1).optional(),
  // 'Google' (Google button through Cognito) or 'COGNITO' (Cognito's own email accounts).
  COGNITO_IDENTITY_PROVIDER: z.string().min(1).default('Google'),
  AUTH_SESSION_SECRET: z.string().min(32).optional(),

  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),

  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().startsWith('mailto:').or(z.url()).optional(),

  CRON_SECRET: secret.optional(),
  IP_HASH_SECRET: secret.optional(),

  // Admin area (D-080): argon2id hash of the admin password and the session-signing key.
  // Without both, /admin stays closed.
  // Copied from a .env file, the hash may keep its `\$` escapes; they are never part of it.
  ADMIN_PASSWORD_HASH: z.preprocess(
    (v) => (typeof v === 'string' ? v.replaceAll('\\$', '$') : v),
    z.string().startsWith('$argon2id$').optional(),
  ),
  ADMIN_SESSION_SECRET: z.string().min(32).optional(),

  // LEGAL-TODO(access-log): enable only after legal advice; see docs/legal-todo.md.
  ACCESS_LOG_ENABLED: flag,
  ACCESS_LOG_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/, 'must be 32 bytes, base64')
    .optional(),
  ACCESS_LOG_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),

  NEXT_PUBLIC_FEATURE_OCR: flag,
  CRON_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
});

export type ServerEnv = z.infer<typeof schema>;

/** Misconfiguration. Its message holds only variable names, so it is safe to log. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

let cached: ServerEnv | undefined;

/** Only close the admin area when wrong; the public site keeps working without them. */
const ADMIN_ONLY = new Set(['ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET']);

/**
 * The environment with empty values dropped: `KEY=` in .env (as copied from .env.example)
 * means "not set", not an empty string that fails validation and breaks every API route.
 */
function setValues(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value.trim() !== '') env[key] = value;
  }
  return env;
}

export function serverEnv(): ServerEnv {
  if (!cached) {
    const raw = setValues();
    let parsed = schema.safeParse(raw);
    let names = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
    if (names.length > 0 && names.every((n) => ADMIN_ONLY.has(n))) {
      // Report names only, never values.
      console.error(`[env] ignoring invalid ${names.join(', ')}: the admin area stays closed`);
      const env = { ...raw };
      for (const n of names) delete env[n];
      parsed = schema.safeParse(env);
      names = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
    }
    if (!parsed.success) {
      // Report names only, never values.
      throw new ConfigError(`Invalid environment variables: ${names.join(', ')}`);
    }
    cached = parsed.data;
  }
  return cached;
}

type RequiredKey = {
  [K in keyof ServerEnv]-?: undefined extends ServerEnv[K] ? K : never;
}[keyof ServerEnv];

export function requireEnv<K extends RequiredKey>(key: K): NonNullable<ServerEnv[K]> {
  const value = serverEnv()[key];
  if (value === undefined || value === null || value === '') {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value as NonNullable<ServerEnv[K]>;
}

/** Test helper: forget the cached parse so a test can change process.env. */
export function resetServerEnvForTests() {
  cached = undefined;
}
