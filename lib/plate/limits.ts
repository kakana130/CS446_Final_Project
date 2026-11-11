/**
 * Hard input limits: what the database stores (posts CHECK constraints) and what the plate
 * input accepts. Deliberately one wider than any valid format, so a slightly wrong reading
 * (e.g. OCR adds a digit) is saved as `unverified` instead of being rejected.
 * Keep in sync with supabase/migrations (asserted by supabase/tests/schema.test.ts).
 */
export const PLATE_LIMITS = {
  letters: 4,
  number: 5,
} as const;

/** Truncate normalized parts to what can be stored. */
export function clampToLimits<T extends { letters: string; number: string }>(plate: T): T {
  return {
    ...plate,
    letters: [...plate.letters].slice(0, PLATE_LIMITS.letters).join(''),
    number: plate.number.slice(0, PLATE_LIMITS.number),
  };
}
