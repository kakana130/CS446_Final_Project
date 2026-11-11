import 'server-only';
import { toDbError } from './errors';
import { rpc as callRpc } from './server';

// Reports and feedback (public) and the admin reads/actions (D-080). No contact details ever
// leave these functions; IPs appear only as short hash prefixes.

export type ReportReason =
  'scam' | 'inappropriate_image' | 'still_on_vehicle' | 'personal_data' | 'other';

export async function reportPost(
  postId: string,
  reason: ReportReason,
  note: string,
  ipHash: string,
): Promise<'reported' | 'duplicate' | 'not_found'> {
  const { data, error } = await callRpc('report_post', {
    p_post_id: postId,
    p_reason: reason,
    p_note: note,
    p_ip_hash: ipHash,
  });
  if (error) throw toDbError('report_post', error);
  return data as 'reported' | 'duplicate' | 'not_found';
}

export async function submitFeedback(
  rating: number,
  comment: string,
  context: 'resolved' | 'general',
  locale: 'th' | 'en',
  ipHash: string,
): Promise<void> {
  const { error } = await callRpc('submit_feedback', {
    p_rating: rating,
    p_comment: comment,
    p_context: context,
    p_locale: locale,
    p_ip_hash: ipHash,
  });
  if (error) throw toDbError('submit_feedback', error);
}

export interface AdminOverview {
  lostActive: number;
  foundActive: number;
  needsReview: number;
  hidden: number;
  resolved: number;
  matches: number;
  reportedPosts: number;
  feedback: number;
  mode: 'active' | 'dormant';
  daily: {
    day: string;
    lost_created: number;
    found_created: number;
    matches: number;
    resolved: number;
  }[];
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await callRpc(fn, args);
  if (error) throw toDbError(fn, error);
  return data as T;
}

export const adminOverview = () => rpc<AdminOverview>('admin_overview');

export interface AdminPost {
  post_id: string;
  batch_id?: string;
  kind: 'lost' | 'found';
  plate_display: string;
  province_code: string | null;
  status: 'active' | 'needs_review' | 'hidden' | 'resolved';
  crop_path: string | null;
  report_count: number;
  created_at: string;
  expires_at?: string;
  reports?: { reason: ReportReason; note: string | null; createdAt: string }[];
}

export const adminReportedPosts = (limit = 50) =>
  rpc<AdminPost[]>('admin_reported_posts', { p_limit: limit });

export const adminFindPosts = (query: string, limit = 50) =>
  rpc<AdminPost[]>('admin_find_posts', { p_query: query, p_limit: limit });

export const adminFeedback = (limit = 100) =>
  rpc<
    {
      id: string;
      rating: number;
      comment: string | null;
      context: 'resolved' | 'general';
      locale: string;
      created_at: string;
    }[]
  >('admin_feedback', { p_limit: limit });

export const adminReveals = (limit = 100) =>
  rpc<
    {
      id: string;
      created_at: string;
      post_id: string;
      plate_display: string;
      match_id: string | null;
      ip_prefix: string;
    }[]
  >('admin_reveals', { p_limit: limit });

export const adminAudit = (limit = 100) =>
  rpc<
    {
      id: number;
      created_at: string;
      action: string;
      target_type: string | null;
      target_id: string | null;
      details: Record<string, unknown>;
    }[]
  >('admin_audit', { p_limit: limit });

export const adminLog = (action: string, details: Record<string, unknown> = {}) =>
  rpc<void>('admin_log', { p_action: action, p_details: details });

export type AdminPostAction = 'hide' | 'restore' | 'delete' | 'dismiss';

export const adminPostAction = (action: AdminPostAction, postId: string) =>
  rpc<number>('admin_post_action', { p_action: action, p_post_id: postId });

export const adminSetMode = (mode: 'active' | 'dormant') =>
  rpc<void>('admin_set_mode', { p_mode: mode });
