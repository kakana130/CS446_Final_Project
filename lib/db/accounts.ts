import 'server-only';
import { toDbError } from './errors';
import { query } from './server';

/**
 * Posts reference their owner in auth.users (D-085). With Cognito the account lives in the
 * user pool, so the first sign-in records the Cognito `sub` there (nothing else is stored).
 */
export async function ensureAccount(userId: string): Promise<void> {
  const { error } = await query('insert into auth.users (id) values ($1) on conflict do nothing', [
    userId,
  ]);
  if (error) throw toDbError('ensure_account', error);
}
