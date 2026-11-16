/**
 * Request schemas shared by forms and API routes. Issue messages are stable error codes that
 * the UI maps to `errors.*` messages; they never contain user input.
 */
import { z } from 'zod';
import { normalizeNumber } from '@/lib/plate/normalize';
import { isKnownProvince } from '@/lib/plate/provinces';
import { PLATE_TYPES } from '@/lib/plate/types';
import { normalizeEmail, normalizeLineId, normalizeThaiPhone } from './contact';
import { findUnsafeText, isSafeDistrict } from './text';

export const ERROR_CODES = [
  'plate_number_required',
  'province_invalid',
  'line_id_invalid',
  'phone_invalid',
  'email_invalid',
  'contact_required',
  'consent_required',
  'text_url',
  'text_id_number',
  'text_account_number',
  'district_invalid',
  'police_note_required',
] as const;
export type FieldErrorCode = (typeof ERROR_CODES)[number];

export const plateInputSchema = z
  .object({
    type: z.enum(PLATE_TYPES),
    prefixDigit: z.string().max(4).nullish(),
    letters: z.string().max(16),
    number: z.string().max(16),
    provinceCode: z.string().max(8).nullish(),
  })
  .superRefine((v, ctx) => {
    if (normalizeNumber(v.number) === '') {
      ctx.addIssue({ code: 'custom', message: 'plate_number_required', path: ['number'] });
    }
    if (v.provinceCode && !isKnownProvince(v.provinceCode)) {
      ctx.addIssue({ code: 'custom', message: 'province_invalid', path: ['provinceCode'] });
    }
  });
export type PlateInputBody = z.infer<typeof plateInputSchema>;

export const contactSchema = z
  .object({
    lineId: z.string().max(64).default(''),
    phone: z.string().max(32).default(''),
    email: z.string().max(254).default(''),
    showEmail: z.boolean().default(false),
  })
  .transform((v, ctx) => {
    const lineId = v.lineId.trim() ? normalizeLineId(v.lineId) : null;
    const phone = v.phone.trim() ? normalizeThaiPhone(v.phone) : null;
    const email = v.email.trim() ? normalizeEmail(v.email) : null;
    let formatError = false;
    const issue = (message: FieldErrorCode, field: string) => {
      formatError = true;
      ctx.addIssue({ code: 'custom', message, path: [field] });
    };
    if (v.lineId.trim() && !lineId) issue('line_id_invalid', 'lineId');
    if (v.phone.trim() && !phone) issue('phone_invalid', 'phone');
    if (v.email.trim() && !email) issue('email_invalid', 'email');
    const showEmail = v.showEmail && email !== null;
    // Only ask for "at least one contact" once the entered ones are valid.
    if (!lineId && !phone && !showEmail && !formatError) {
      ctx.addIssue({ code: 'custom', message: 'contact_required', path: ['lineId'] });
    }
    return { lineId, phone, email, showEmail };
  });
export type ContactBody = z.input<typeof contactSchema>;
export type Contact = z.output<typeof contactSchema>;

const turnstileToken = z.string().min(1).max(2048);
const consent = z.literal(true, { error: 'consent_required' });
const locale = z.enum(['th', 'en']);

function unsafeTextIssue(text: string): FieldErrorCode | null {
  const reason = findUnsafeText(text);
  return reason ? (`text_${reason}` as FieldErrorCode) : null;
}

/** Optional free-text note (หมายเหตุ): ≤ 300 chars, no links, account or ID numbers. */
export const noteSchema = z
  .string()
  .trim()
  .max(300)
  .default('')
  .superRefine((v, ctx) => {
    const issue = unsafeTextIssue(v);
    if (issue) ctx.addIssue({ code: 'custom', message: issue });
  });

/** Free text for reports and feedback: same rules as notes, other lengths. */
const freeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .default('')
    .superRefine((v, ctx) => {
      const issue = unsafeTextIssue(v);
      if (issue) ctx.addIssue({ code: 'custom', message: issue });
    });

export const REPORT_REASONS = [
  'scam',
  'inappropriate_image',
  'still_on_vehicle',
  'personal_data',
  'other',
] as const;

export const reportSchema = z.object({
  postId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  note: freeText(300),
  turnstileToken: z.string().min(1).max(2048),
});
export type ReportBody = z.input<typeof reportSchema>;

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: freeText(500),
  context: z.enum(['resolved', 'general']).default('general'),
  locale: z.enum(['th', 'en']),
  turnstileToken: z.string().min(1).max(2048),
});
export type FeedbackBody = z.input<typeof feedbackSchema>;

export const adminLoginSchema = z.object({ password: z.string().min(1).max(200) });

export const adminActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['hide', 'restore', 'delete', 'dismiss']), postId: z.uuid() }),
  z.object({ action: z.literal('mode'), mode: z.enum(['active', 'dormant']) }),
]);
export type AdminActionBody = z.input<typeof adminActionSchema>;

export const lostCreateSchema = z.object({
  plate: plateInputSchema,
  contact: contactSchema,
  note: noteSchema,
  consent,
  consentVersion: z.string().max(32),
  locale,
  turnstileToken,
});
export type LostCreateBody = z.input<typeof lostCreateSchema>;

export const foundBatchSchema = z
  .object({
    contact: contactSchema,
    consent,
    consentVersion: z.string().max(32),
    locale,
    handover: z.enum(['with_finder', 'police_station']),
    policeStationNote: z.string().trim().max(120).default(''),
    district: z.string().trim().max(80).default(''),
    note: noteSchema,
    turnstileToken,
  })
  .superRefine((v, ctx) => {
    if (v.handover === 'police_station' && !v.policeStationNote) {
      ctx.addIssue({
        code: 'custom',
        message: 'police_note_required',
        path: ['policeStationNote'],
      });
    }
    const noteIssue = unsafeTextIssue(v.policeStationNote);
    if (noteIssue)
      ctx.addIssue({ code: 'custom', message: noteIssue, path: ['policeStationNote'] });
    if (v.district && !isSafeDistrict(v.district)) {
      ctx.addIssue({ code: 'custom', message: 'district_invalid', path: ['district'] });
    }
  });
export type FoundBatchBody = z.input<typeof foundBatchSchema>;

export const foundPlateSchema = z.object({
  plate: plateInputSchema,
  /** The user confirmed the plate is detached despite the plate-on-vehicle warning (Phase 6). */
  vehicleWarning: z.boolean().default(false),
  ocrMinConfidence: z.number().min(0).max(1).nullish(),
});
export type FoundPlateBody = z.input<typeof foundPlateSchema>;

export const searchSchema = z.object({ plate: plateInputSchema });

export const revealSchema = z.object({
  postId: z.uuid(),
  /** The user ticked "I've read the safety advice" in the reveal dialog. */
  acknowledged: z.literal(true, { error: 'consent_required' }),
  turnstileToken: z.string().min(1).max(2048),
});
export type RevealBody = z.input<typeof revealSchema>;

const deviceToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** "My posts": the (batch id, device token) pairs stored on this phone. */
export const myPostsSchema = z.object({
  devices: z.array(z.object({ batchId: z.uuid(), token: deviceToken })).max(50),
});

/**
 * Manage a post (D-078, D-085): prove ownership with this device's token, or by being signed
 * in to the account that owns the batch (any device).
 */
export const manageSchema = z.object({
  auth: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('device'), batchId: z.uuid(), token: deviceToken }),
    z.object({ kind: z.literal('account'), batchId: z.uuid() }),
  ]),
  action: z.enum(['list', 'resolve', 'extend', 'delete']),
  postId: z.uuid().nullish(),
});
export type ManageBody = z.input<typeof manageSchema>;

/**
 * The finder asks for the owner's contact, proving it with the found batch's device token or,
 * without one, with the signed-in account that posted it.
 */
export const revealOwnerSchema = z.object({ matchId: z.uuid(), token: deviceToken.optional() });

/** What the signed-in account is on a match page: its finder, its owner, or neither. */
export const matchRoleSchema = z.object({ matchId: z.uuid() });
export type SearchBody = z.input<typeof searchSchema>;

/** Flatten zod issues into `{ path: code }` for the form (first issue per field wins). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!(key in out)) {
      out[key] = (ERROR_CODES as readonly string[]).includes(issue.message)
        ? issue.message
        : 'invalid';
    }
  }
  return out;
}
