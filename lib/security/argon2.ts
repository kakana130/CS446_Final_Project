import 'server-only';
import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with OWASP's minimum recommended parameters (m=19 MiB, t=2, p=1). The library's
 * default algorithm is argon2id (asserted by tests via the `$argon2id$` prefix).
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashSecret(secret: string): Promise<string> {
  return hash(secret, OPTIONS);
}

/** Constant-time verification (inside argon2). Never throws: malformed hashes are a mismatch. */
export async function verifySecret(secretHash: string, secret: string): Promise<boolean> {
  try {
    return await verify(secretHash, secret);
  } catch {
    return false;
  }
}
