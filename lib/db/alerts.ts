import 'server-only';
import { toDbError } from './errors';
import { rpc } from './server';

export interface MatchAlert {
  matchId: string;
  /** Who is emailed: the lost plate's owner or the finder. Both may opt in. */
  role: 'owner' | 'finder';
  /** The recipient's own plate, then the other side's (they differ on a near match). */
  plateDisplay: string;
  otherPlateDisplay: string;
  /** ISO timestamp of the found post. */
  foundAt: string;
  handover: 'with_finder' | 'police_station' | null;
  locale: 'th' | 'en';
  email: string;
  /** The other side's contact, as the reveal flow shows it (email only if they show it). */
  other: {
    lineId: string | null;
    phone: string | null;
    email: string | null;
    /** For owners: where the finder is (district) and the police station, if handed in. */
    district: string | null;
    policeNote: string | null;
  };
}

/** One row per person to email about new matches: owners and finders who opted in. */
export async function matchAlerts(matchIds: string[]): Promise<MatchAlert[]> {
  if (matchIds.length === 0) return [];
  const { data, error } = await rpc<
    {
      match_id: string;
      role: 'owner' | 'finder';
      plate_display: string;
      other_plate_display: string;
      found_created_at: string | Date;
      found_handover: 'with_finder' | 'police_station' | null;
      locale: 'th' | 'en';
      email: string;
      other_line_id: string | null;
      other_phone: string | null;
      other_email: string | null;
      other_district: string | null;
      other_police_note: string | null;
    }[]
  >('match_alerts', { p_match_ids: matchIds });
  if (error) throw toDbError('match_alerts', error);
  return data.map((r) => ({
    matchId: r.match_id,
    role: r.role,
    plateDisplay: r.plate_display,
    otherPlateDisplay: r.other_plate_display,
    foundAt: new Date(r.found_created_at).toISOString(),
    handover: r.found_handover,
    locale: r.locale,
    email: r.email,
    other: {
      lineId: r.other_line_id,
      phone: r.other_phone,
      email: r.other_email,
      district: r.other_district,
      policeNote: r.other_police_note,
    },
  }));
}

export async function markMatchesNotified(matchIds: string[]): Promise<number> {
  if (matchIds.length === 0) return 0;
  const { data, error } = await rpc<number>('mark_matches_notified', { p_match_ids: matchIds });
  if (error) throw toDbError('mark_matches_notified', error);
  return data;
}

/** Emails that keep their SNS subscription (anyone with an active post and alerts on). */
export async function alertEmails(): Promise<string[]> {
  const { data, error } = await rpc<string[]>('alert_emails');
  if (error) throw toDbError('alert_emails', error);
  return data ?? [];
}
