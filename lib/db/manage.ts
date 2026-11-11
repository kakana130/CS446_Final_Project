import 'server-only';
import type { MyPost } from './mine';
import { toDbError } from './errors';
import { rpc } from './server';

export async function batchOwned(batchId: string, tokenHash: string): Promise<boolean> {
  const { data, error } = await rpc('batch_owned', {
    p_batch_id: batchId,
    p_token_hash: tokenHash,
  });
  if (error) throw toDbError('batch_owned', error);
  return data === true;
}

/** The signed-in account owns the batch (D-085). */
export async function batchOwnedBy(batchId: string, userId: string): Promise<boolean> {
  const { data, error } = await rpc('batch_owned_by', {
    p_batch_id: batchId,
    p_user_id: userId,
  });
  if (error) throw toDbError('batch_owned_by', error);
  return data === true;
}

export async function batchPosts(batchId: string): Promise<MyPost[]> {
  const { data, error } = await rpc('batch_posts', { p_batch_id: batchId });
  if (error) throw toDbError('batch_posts', error);
  return (
    data as {
      batch_id: string;
      post_id: string;
      kind: MyPost['kind'];
      plate_type: MyPost['plate']['type'];
      prefix_digit: string | null;
      letters: string;
      number: string;
      province_code: string | null;
      status: MyPost['status'];
      created_at: string;
      expires_at: string;
      matches: MyPost['matches'];
    }[]
  ).map((r) => ({
    batchId: r.batch_id,
    postId: r.post_id,
    kind: r.kind,
    plate: {
      type: r.plate_type,
      prefixDigit: r.prefix_digit,
      letters: r.letters,
      number: r.number,
      provinceCode: r.province_code,
    },
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    matches: r.matches,
  }));
}

export type ManageAction = 'resolve' | 'extend' | 'delete';

/** Apply the owner's action to one post, or the whole batch when `postId` is null. */
export async function managePost(
  batchId: string,
  postId: string | null,
  action: ManageAction,
): Promise<number> {
  const { data, error } = await rpc('manage_post', {
    p_batch_id: batchId,
    p_post_id: postId,
    p_action: action,
  });
  if (error) throw toDbError('manage_post', error);
  return Number(data ?? 0);
}
