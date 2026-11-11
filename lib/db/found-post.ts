import 'server-only';
import type { Plate, PlateType } from '@/lib/plate/types';
import { toDbError } from './errors';
import { rpc } from './server';

export type Handover = 'with_finder' | 'police_station';

export interface FoundPost {
  postId: string;
  plate: Plate;
  formatStatus: 'valid' | 'unverified';
  cropPath: string | null;
  createdAt: string;
  handover: Handover | null;
}

/** Public view of an active found post (no contact, no district). Null if not visible. */
export async function getFoundPost(postId: string): Promise<FoundPost | null> {
  const { data, error } = await rpc('get_found_post', { p_post_id: postId });
  if (error) throw toDbError('get_found_post', error);
  const r = (
    data as {
      post_id: string;
      plate_type: PlateType;
      prefix_digit: string | null;
      letters: string;
      number: string;
      province_code: string | null;
      format_status: 'valid' | 'unverified';
      crop_path: string | null;
      created_at: string;
      handover: Handover | null;
    }[]
  )[0];
  if (!r) return null;
  return {
    postId: r.post_id,
    plate: {
      type: r.plate_type,
      prefixDigit: r.prefix_digit,
      letters: r.letters,
      number: r.number,
      provinceCode: r.province_code,
    },
    formatStatus: r.format_status,
    cropPath: r.crop_path,
    createdAt: r.created_at,
    handover: r.handover,
  };
}

export interface RevealedContact {
  lineId: string | null;
  phone: string | null;
  email: string | null;
  handover: Handover | null;
  policeStationNote: string | null;
  district: string | null;
  note: string | null;
}

/** The finder's contact for an active found post; logs the reveal. Null if not visible. */
export async function revealFoundContact(
  postId: string,
  ipHash: string,
): Promise<RevealedContact | null> {
  const { data, error } = await rpc('reveal_found_contact', {
    p_post_id: postId,
    p_ip_hash: ipHash,
  });
  if (error) throw toDbError('reveal_found_contact', error);
  const r = (
    data as {
      line_id: string | null;
      phone: string | null;
      email: string | null;
      handover: Handover | null;
      police_station_note: string | null;
      district: string | null;
      note: string | null;
    }[]
  )[0];
  if (!r) return null;
  return {
    note: r.note,
    lineId: r.line_id,
    phone: r.phone,
    email: r.email,
    handover: r.handover,
    policeStationNote: r.police_station_note,
    district: r.district,
  };
}
