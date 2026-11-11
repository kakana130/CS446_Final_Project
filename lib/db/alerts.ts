import 'server-only';
import { toDbError } from './errors';
import { rpc } from './server';

export interface MatchAlert {
  matchId: string;
  lostPostId: string;
  plateDisplay: string;
  locale: 'th' | 'en';
  email: string;
}

/** New matches whose lost-plate owner opted in to email alerts (both posts active). */
export async function matchAlerts(matchIds: string[]): Promise<MatchAlert[]> {
  if (matchIds.length === 0) return [];
  const { data, error } = await rpc<
    {
      match_id: string;
      lost_post_id: string;
      plate_display: string;
      locale: 'th' | 'en';
      email: string;
    }[]
  >('match_alerts', { p_match_ids: matchIds });
  if (error) throw toDbError('match_alerts', error);
  return data.map((r) => ({
    matchId: r.match_id,
    lostPostId: r.lost_post_id,
    plateDisplay: r.plate_display,
    locale: r.locale,
    email: r.email,
  }));
}

export async function markMatchesNotified(matchIds: string[]): Promise<number> {
  if (matchIds.length === 0) return 0;
  const { data, error } = await rpc<number>('mark_matches_notified', { p_match_ids: matchIds });
  if (error) throw toDbError('mark_matches_notified', error);
  return data;
}

/** Emails that keep their SNS subscription (active lost watches with alerts on). */
export async function alertEmails(): Promise<string[]> {
  const { data, error } = await rpc<string[]>('alert_emails');
  if (error) throw toDbError('alert_emails', error);
  return data ?? [];
}
