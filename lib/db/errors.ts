/** A database call failed. Carries only the Postgres/PostgREST error code, never the message. */
export class DbError extends Error {
  override readonly name = 'DbError';
  constructor(
    readonly op: string,
    readonly code: string | undefined,
    /** Stable, app-defined reason raised by our SQL functions (e.g. `batch_full`). */
    readonly reason?: string,
  ) {
    super(`${op} failed${code ? ` (${code})` : ''}`);
  }
}

const KNOWN_REASONS = ['upload_token_invalid', 'batch_full'] as const;
export type DbReason = (typeof KNOWN_REASONS)[number];

export function toDbError(op: string, error: { code?: string; message?: string }): DbError {
  const reason = KNOWN_REASONS.find((r) => error.message?.includes(r));
  return new DbError(op, error.code, reason);
}
