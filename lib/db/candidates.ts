import 'server-only';
import type { Plate, PlateType } from '@/lib/plate/types';
import { toDbError } from './errors';
import { rpc } from './server';

export interface Candidate {
  id: string;
  batchId: string;
  kind: 'lost' | 'found';
  plate: Plate;
  formatStatus: 'valid' | 'unverified';
  cropPath: string | null;
  createdAt: string;
}

interface CandidateRow {
  id: string;
  batch_id: string;
  kind: 'lost' | 'found';
  plate_type: PlateType;
  prefix_digit: string | null;
  letters: string;
  number: string;
  province_code: string | null;
  format_status: 'valid' | 'unverified';
  crop_path: string | null;
  created_at: string;
}

/**
 * Active, unexpired posts of the *opposite* kind that might match (trigram on the folded key,
 * same number, or stored wildcards). Recall-oriented; score with `scorePlates` afterwards.
 */
export async function fetchCandidates(
  forKind: 'lost' | 'found',
  plate: Plate,
  key: string,
): Promise<Candidate[]> {
  const { data, error } = await rpc('plate_candidates', {
    p_kind: forKind,
    p_plate_type: plate.type,
    p_key: key,
    p_number: plate.number,
  });
  if (error) throw toDbError('plate_candidates', error);
  return (data as CandidateRow[]).map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    kind: r.kind,
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
  }));
}
