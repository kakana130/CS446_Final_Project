import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizeLineId, normalizeThaiPhone } from './contact';
import {
  contactSchema,
  fieldErrors,
  foundBatchSchema,
  lostCreateSchema,
  plateInputSchema,
} from './schemas';
import { findUnsafeText, isSafeDistrict } from './text';

describe('normalizeLineId', () => {
  it.each([
    ['myline', 'myline'],
    ['MyLine.01', 'myline.01'],
    ['@shopname', '@shopname'],
    ['Line ID: abc_123', 'abc_123'],
    ['ไลน์ abcd', 'abcd'],
  ])('%s → %s', (raw, expected) => expect(normalizeLineId(raw)).toBe(expected));

  it.each(['abc', 'has space', 'a'.repeat(21), 'ไทย1234', 'x/y/z/w'])('rejects %s', (raw) =>
    expect(normalizeLineId(raw)).toBeNull(),
  );
});

describe('normalizeThaiPhone', () => {
  it.each([
    ['0812345678', '0812345678'],
    ['081-234-5678', '0812345678'],
    ['+66 81 234 5678', '0812345678'],
    ['66812345678', '0812345678'],
    ['(02) 123 4567', '021234567'],
    ['๐๘๑๒๓๔๕๖๗๘', '0812345678'],
  ])('%s → %s', (raw, expected) => expect(normalizeThaiPhone(raw)).toBe(expected));

  it.each(['12345', '0112345678', '08123456789', '1812345678'])('rejects %s', (raw) =>
    expect(normalizeThaiPhone(raw)).toBeNull(),
  );
});

describe('normalizeEmail', () => {
  it('lower-cases and trims', () => expect(normalizeEmail(' A@B.co ')).toBe('a@b.co'));
  it('rejects malformed addresses', () => {
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('no at.com')).toBeNull();
  });
});

describe('findUnsafeText', () => {
  it.each([
    ['โอนมาที่ https://x.co', 'url'],
    ['www.scam.com', 'url'],
    ['แอดไลน์ line.me/ti/p/abc', 'url'],
    ['scam-site.shop', 'url'],
    ['1234567890123', 'id_number'],
    ['1-2345-67890-12-3', 'id_number'],
    ['บัญชี 123-4-56789-0', 'account_number'],
    ['พร้อมเพย์ 0812345678', 'account_number'],
  ])('%s → %s', (text, reason) => expect(findUnsafeText(text)).toBe(reason));

  it.each(['สภ.เมืองเชียงใหม่', 'สน.บางเขน ชั้น 2', 'ป้ายอยู่กับเจ้าหน้าที่ เบอร์ภายใน 123'])(
    'allows %s',
    (text) => expect(findUnsafeText(text)).toBeNull(),
  );

  it('rejects digits in a district (blocks house numbers)', () => {
    expect(isSafeDistrict('บางเขน')).toBe(true);
    expect(isSafeDistrict('บ้านเลขที่ 12/3')).toBe(false);
  });
});

describe('contactSchema', () => {
  it('normalizes values', () => {
    expect(contactSchema.parse({ lineId: 'MyID', phone: '081 234 5678' })).toEqual({
      lineId: 'myid',
      phone: '0812345678',
      email: null,
      showEmail: false,
    });
  });

  it('requires at least one contact the other side can see', () => {
    const r = contactSchema.safeParse({ email: 'a@b.co', showEmail: false });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!)).toEqual({ lineId: 'contact_required' });
  });

  it('accepts email alone when shown as a contact', () => {
    expect(contactSchema.safeParse({ email: 'a@b.co', showEmail: true }).success).toBe(true);
  });

  it('reports format errors per field instead of "contact required"', () => {
    const r = contactSchema.safeParse({ lineId: 'x', phone: '123' });
    expect(fieldErrors(r.error!)).toEqual({ lineId: 'line_id_invalid', phone: 'phone_invalid' });
  });
});

describe('plateInputSchema', () => {
  it('requires a number', () => {
    const r = plateInputSchema.safeParse({ type: 'car', letters: 'กข', number: ' ' });
    expect(fieldErrors(r.error!)).toEqual({ number: 'plate_number_required' });
  });

  it('rejects unknown province codes', () => {
    const r = plateInputSchema.safeParse({
      type: 'car',
      letters: 'กข',
      number: '1',
      provinceCode: 'TH-99',
    });
    expect(fieldErrors(r.error!)).toEqual({ provinceCode: 'province_invalid' });
  });

  it('accepts wildcards and unknown province', () => {
    expect(
      plateInputSchema.safeParse({ type: 'car', letters: 'ก?', number: '12?4', provinceCode: null })
        .success,
    ).toBe(true);
  });
});

const baseLost = {
  plate: { type: 'car', letters: 'กข', number: '1234', provinceCode: 'TH-10' },
  contact: { lineId: 'owner1' },
  consent: true,
  consentVersion: '2026-09-v1',
  locale: 'th',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
};

describe('lostCreateSchema', () => {
  it('accepts a complete request', () => {
    expect(lostCreateSchema.safeParse(baseLost).success).toBe(true);
  });

  it('requires consent', () => {
    const r = lostCreateSchema.safeParse({ ...baseLost, consent: false });
    expect(fieldErrors(r.error!)).toEqual({ consent: 'consent_required' });
  });

  it('rejects unknown fields silently (strips them)', () => {
    const r = lostCreateSchema.parse({ ...baseLost, isAdmin: true });
    expect(r).not.toHaveProperty('isAdmin');
  });
});

describe('foundBatchSchema', () => {
  const base = {
    contact: { phone: '0812345678' },
    consent: true,
    consentVersion: '2026-09-v1',
    locale: 'th',
    handover: 'with_finder',
    turnstileToken: 't',
  };

  it('requires a station name when the plate is at the police station', () => {
    const r = foundBatchSchema.safeParse({ ...base, handover: 'police_station' });
    expect(fieldErrors(r.error!)).toEqual({ policeStationNote: 'police_note_required' });
  });

  it('blocks payment details and links in the station note', () => {
    const r = foundBatchSchema.safeParse({
      ...base,
      handover: 'police_station',
      policeStationNote: 'โอนค่าส่ง 123-4-56789-0',
    });
    expect(fieldErrors(r.error!)).toEqual({ policeStationNote: 'text_account_number' });
  });

  it('blocks house numbers in the district', () => {
    const r = foundBatchSchema.safeParse({ ...base, district: 'ซอย 5 บ้าน 12' });
    expect(fieldErrors(r.error!)).toEqual({ district: 'district_invalid' });
  });
});

describe('noteSchema', () => {
  it('accepts plain descriptions and trims them', async () => {
    const { noteSchema } = await import('./schemas');
    expect(noteSchema.parse('  ป้ายหลัง มีสติกเกอร์  ')).toBe('ป้ายหลัง มีสติกเกอร์');
    expect(noteSchema.parse(undefined)).toBe('');
  });

  it('blocks links, account and ID numbers, and overlong text', async () => {
    const { noteSchema } = await import('./schemas');
    const code = (v: string) => fieldErrors(noteSchema.safeParse(v).error!)[''];
    expect(code('ติดต่อ line.me/ti/p/abc')).toBe('text_url');
    expect(code('โอนค่าส่งมาที่ 123-4-56789-0')).toBe('text_account_number');
    expect(code('บัตร 1234567890123')).toBe('text_id_number');
    expect(noteSchema.safeParse('ก'.repeat(301)).success).toBe(false);
  });
});

describe('revealSchema', () => {
  it('requires a post UUID, the safety acknowledgement and a token', async () => {
    const { revealSchema } = await import('./schemas');
    const ok = {
      postId: '00000000-0000-4000-8000-000000000001',
      acknowledged: true,
      turnstileToken: 't',
    };
    expect(revealSchema.safeParse(ok).success).toBe(true);
    expect(fieldErrors(revealSchema.safeParse({ ...ok, acknowledged: false }).error!)).toEqual({
      acknowledged: 'consent_required',
    });
    expect(revealSchema.safeParse({ ...ok, postId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('manageSchema', () => {
  it('accepts a device token or the signed-in account, never a PIN', async () => {
    const { manageSchema } = await import('./schemas');
    const batchId = '00000000-0000-4000-8000-000000000001';
    const token = 'A'.repeat(43);
    const parse = (auth: unknown) => manageSchema.safeParse({ auth, action: 'list' }).success;
    expect(parse({ kind: 'device', batchId, token })).toBe(true);
    expect(parse({ kind: 'account', batchId })).toBe(true);
    expect(
      parse({ kind: 'pin', plate: { type: 'car', letters: 'กข', number: '1' }, pin: '2580' }),
    ).toBe(false);
  });
});
