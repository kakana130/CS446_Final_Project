import 'server-only';
import type { MatchKind } from '@/lib/matching/score';
import type { Plate, PlateType } from '@/lib/plate/types';
import { toDbError } from './errors';
import { rpc } from './server';

export interface MyPost {
  batchId: string;
  postId: string;
  kind: 'lost' | 'found';
  plate: Plate;
  status: 'active' | 'needs_review' | 'hidden' | 'resolved';
  createdAt: string;
  expiresAt: string;
  matches: { matchId: string; kind: MatchKind; createdAt: string }[];
}

type DeviceProof = { batchId: string; tokenHash: string };

/**
 * Posts of the batches whose device token hash matches, plus every batch the signed-in
 * account owns (D-085); no contact details.
 */
export async function myPosts(devices: DeviceProof[], userId: string | null): Promise<MyPost[]> {
  if (devices.length === 0 && !userId) return [];
  const { data, error } = await rpc('my_posts', {
    p_batch_ids: devices.map((d) => d.batchId),
    p_token_hashes: devices.map((d) => d.tokenHash),
    p_user_id: userId,
  });
  if (error) throw toDbError('my_posts', error);
  return (
    data as {
      batch_id: string;
      post_id: string;
      kind: 'lost' | 'found';
      plate_type: PlateType;
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

export interface OwnerContact {
  lineId: string | null;
  phone: string | null;
  email: string | null;
}

/** The owner's contact for the matched finder (device token proof); logged. Null if refused. */
export async function revealOwnerContact(
  matchId: string,
  tokenHash: string,
  ipHash: string,
): Promise<OwnerContact | null> {
  const { data, error } = await rpc('reveal_owner_contact', {
    p_match_id: matchId,
    p_device_token_hash: tokenHash,
    p_ip_hash: ipHash,
  });
  if (error) throw toDbError('reveal_owner_contact', error);
  const r = (data as { line_id: string | null; phone: string | null; email: string | null }[])[0];
  return r ? { lineId: r.line_id, phone: r.phone, email: r.email } : null;
}

/** Link this device's posts (proven by their tokens) to the signed-in account. */
export async function claimBatches(userId: string, devices: DeviceProof[]): Promise<number> {
  if (devices.length === 0) return 0;
  const { data, error } = await rpc('claim_batches', {
    p_user_id: userId,
    p_batch_ids: devices.map((d) => d.batchId),
    p_token_hashes: devices.map((d) => d.tokenHash),
  });
  if (error) throw toDbError('claim_batches', error);
  return data as number;
}

/** The owner's contact for the matched finder, proven by the finder's account; logged. */
export async function revealOwnerContactForUser(
  matchId: string,
  userId: string,
  ipHash: string,
): Promise<OwnerContact | null> {
  const { data, error } = await rpc('reveal_owner_contact_for_user', {
    p_match_id: matchId,
    p_user_id: userId,
    p_ip_hash: ipHash,
  });
  if (error) throw toDbError('reveal_owner_contact_for_user', error);
  const r = (data as { line_id: string | null; phone: string | null; email: string | null }[])[0];
  return r ? { lineId: r.line_id, phone: r.phone, email: r.email } : null;
}

/** Did the signed-in account post the found plate of this match, or the lost one? */
export async function matchRoles(
  matchId: string,
  userId: string,
): Promise<{ finder: boolean; owner: boolean }> {
  const { data, error } = await rpc('match_roles', {
    p_match_id: matchId,
    p_user_id: userId,
  });
  if (error) throw toDbError('match_roles', error);
  const r = (data as { is_finder: boolean; is_owner: boolean }[])[0];
  return { finder: r?.is_finder ?? false, owner: r?.is_owner ?? false };
}
