import 'server-only';
import type { PlateInput } from '@/lib/plate/types';
import { toDbError } from './errors';
import { rpc } from './server';

/** Rows deleted per kind by one retention run (D-089). */
export type PurgeCounts = Record<string, number>;

export async function purgeExpiredData(accessLogDays: number): Promise<PurgeCounts> {
  const { data, error } = await rpc('purge_expired_data', {
    p_access_log_days: accessLogDays,
  });
  if (error) throw toDbError('purge_expired_data', error);
  return data as PurgeCounts;
}

/** Crop paths queued for removal from storage (oldest first, failing ones skipped). */
export async function pendingStoragePaths(limit: number): Promise<string[]> {
  const { data, error } = await rpc('pending_storage_paths', { p_limit: limit });
  if (error) throw toDbError('pending_storage_paths', error);
  return (data as string[] | null) ?? [];
}

export interface RecentPost {
  id: string;
  kind: 'lost' | 'found';
  plate: PlateInput;
}

/** Active, unexpired posts created since `since` (newest first), for the matching safety net. */
export async function recentActivePosts(since: Date, limit: number): Promise<RecentPost[]> {
  const { data, error } = await rpc('recent_active_posts', {
    p_since: since.toISOString(),
    p_limit: limit,
  });
  if (error) throw toDbError('recent_active_posts', error);
  return (
    (data as {
      id: string;
      kind: 'lost' | 'found';
      plate_type: PlateInput['type'];
      prefix_digit: string | null;
      letters: string;
      number: string;
      province_code: string | null;
    }[]) ?? []
  ).map((r) => ({
    id: r.id,
    kind: r.kind,
    plate: {
      type: r.plate_type,
      prefixDigit: r.prefix_digit,
      letters: r.letters,
      number: r.number,
      provinceCode: r.province_code,
    },
  }));
}

export async function storagePathsDone(removed: string[], failed: string[]): Promise<void> {
  const { error } = await rpc('storage_paths_done', {
    p_removed: removed,
    p_failed: failed,
  });
  if (error) throw toDbError('storage_paths_done', error);
}
