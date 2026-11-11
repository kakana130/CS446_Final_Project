import { describe, expect, it } from 'vitest';
import { normalizePlate } from '@/lib/plate/normalize';
import { selectMatches } from './select';

const plate = (letters: string, number: string, provinceCode: string | null = 'TH-10') =>
  normalizePlate({ type: 'car', letters, number, provinceCode });

const cand = (
  id: string,
  letters: string,
  number: string,
  createdAt: string,
  province?: string | null,
) => ({
  id,
  plate: plate(letters, number, province === undefined ? 'TH-10' : province),
  createdAt,
});

describe('selectMatches', () => {
  const query = plate('กข', '1234');

  it('drops non-matches and ranks exact first, then by score, then newest', () => {
    const result = selectMatches(query, [
      cand('near-old', 'กข', '7234', '2026-09-01T00:00:00Z'),
      cand('none', 'มท', '5678', '2026-09-20T00:00:00Z'),
      cand('exact', 'กข', '1234', '2026-08-01T00:00:00Z'),
      cand('near-new', 'กข', '7234', '2026-09-10T00:00:00Z'),
      cand('weaker', 'กข', '1235', '2026-09-15T00:00:00Z'),
    ]);
    expect(result.map((r) => r.candidate.id)).toEqual(['exact', 'near-new', 'near-old', 'weaker']);
    expect(result[0]?.score.kind).toBe('exact');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      cand(`c${i}`, 'กข', '1234', `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
    );
    expect(selectMatches(query, many, 3)).toHaveLength(3);
  });
});
