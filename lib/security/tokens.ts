import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for device tokens and upload tokens. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 hex. Correct for high-entropy tokens (a slow hash adds nothing when the input
 * has 256 bits of entropy). The admin password uses argon2id instead (lib/security/argon2.ts).
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
