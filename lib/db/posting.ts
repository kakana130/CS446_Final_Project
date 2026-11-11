import 'server-only';
import type { PlateRecord } from '@/lib/plate/canonical';
import type { Contact } from '@/lib/validation/schemas';
import { toDbError } from './errors';
import { rpc } from './server';

function plateArgs(record: PlateRecord) {
  const { plate } = record;
  return {
    p_plate_type: plate.type,
    p_prefix_digit: plate.prefixDigit,
    p_letters: plate.letters,
    p_number: plate.number,
    p_province_code: plate.provinceCode,
    p_canonical: record.canonical,
    p_key: record.key,
    p_display: record.display,
    p_has_wildcards: record.hasWildcards,
    p_format_status: record.validation.status,
  };
}

function contactArgs(contact: Contact) {
  return {
    p_line_id: contact.lineId,
    p_phone: contact.phone,
    p_email: contact.email,
    p_show_email: contact.showEmail,
  };
}

export interface CreateLostWatchInput {
  record: PlateRecord;
  contact: Contact;
  /** The signed-in account, if any (D-085). */
  ownerId: string | null;
  deviceTokenHash: string;
  locale: 'th' | 'en';
  consentVersion: string;
  notifyEmail: boolean;
  note: string | null;
}

export async function createLostWatch(input: CreateLostWatchInput) {
  const { data, error } = await rpc('create_lost_watch', {
    p_owner_id: input.ownerId,
    p_device_token_hash: input.deviceTokenHash,
    p_locale: input.locale,
    p_consent_version: input.consentVersion,
    ...contactArgs(input.contact),
    p_notify_email: input.notifyEmail,
    ...plateArgs(input.record),
    p_note: input.note,
  });
  if (error) throw toDbError('create_lost_watch', error);
  const row = (data as { out_batch_id: string; out_post_id: string }[])[0]!;
  return { batchId: row.out_batch_id, postId: row.out_post_id };
}

export interface CreateFoundBatchInput {
  contact: Contact;
  ownerId: string | null;
  deviceTokenHash: string;
  uploadTokenHash: string;
  uploadTokenExpiresAt: Date;
  locale: 'th' | 'en';
  consentVersion: string;
  handover: 'with_finder' | 'police_station';
  policeStationNote: string | null;
  district: string | null;
  note: string | null;
}

export async function createFoundBatch(input: CreateFoundBatchInput): Promise<string> {
  const { data, error } = await rpc('create_found_batch', {
    p_owner_id: input.ownerId,
    p_device_token_hash: input.deviceTokenHash,
    p_upload_token_hash: input.uploadTokenHash,
    p_upload_token_expires_at: input.uploadTokenExpiresAt.toISOString(),
    p_locale: input.locale,
    p_consent_version: input.consentVersion,
    p_handover: input.handover,
    p_police_station_note: input.policeStationNote,
    p_district: input.district,
    ...contactArgs(input.contact),
    p_note: input.note,
  });
  if (error) throw toDbError('create_found_batch', error);
  return data as string;
}

export async function checkUploadToken(batchId: string, uploadTokenHash: string): Promise<boolean> {
  const { data, error } = await rpc('check_upload_token', {
    p_batch_id: batchId,
    p_upload_token_hash: uploadTokenHash,
  });
  if (error) throw toDbError('check_upload_token', error);
  return data === true;
}

export interface AddFoundPlateInput {
  batchId: string;
  uploadTokenHash: string;
  postId: string;
  record: PlateRecord;
  cropPath: string;
  status: 'active' | 'needs_review';
  reviewReason: string[];
  ocrMinConfidence: number | null;
  maxPlates: number;
}

export async function addFoundPlate(input: AddFoundPlateInput): Promise<string> {
  const { data, error } = await rpc('add_found_plate', {
    p_batch_id: input.batchId,
    p_upload_token_hash: input.uploadTokenHash,
    p_post_id: input.postId,
    ...plateArgs(input.record),
    p_crop_path: input.cropPath,
    p_status: input.status,
    p_review_reason: input.reviewReason,
    p_ocr_min_confidence: input.ocrMinConfidence,
    p_max_plates: input.maxPlates,
  });
  if (error) throw toDbError('add_found_plate', error);
  return data as string;
}
