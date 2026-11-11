/**
 * End-to-end API flow against a real PostgreSQL database with the schema applied
 * (`npm run db:migrate`; Amazon RDS, a local Postgres, or CI's service container):
 * lost watch → found batch → plate upload → instant match → search → match view.
 * Amazon S3 and AWS Lambda calls are intercepted (no AWS account needed): uploads are kept in
 * memory, presigned URLs are really signed with dummy credentials, and Lambda invocations are
 * recorded so the SNS alert flow (subscribe → notify → prune) can be checked.
 * Skipped unless DATABASE_URL is set.
 */
import { randomBytes } from 'node:crypto';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { hashSync } from '@node-rs/argon2';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONSENT_VERSION } from '@/lib/config/app';

const configured = Boolean(process.env.DATABASE_URL);

// AWS: fake region/bucket/function and dummy credentials (presigning is local, no network).
process.env.AWS_REGION = 'us-east-1';
process.env.S3_BUCKET = 'plate2home-itest';
process.env.NOTIFY_LAMBDA_NAME = 'plate2home-notify';
process.env.AWS_ACCESS_KEY_ID = 'AKIAITESTITESTITEST0';
process.env.AWS_SECRET_ACCESS_KEY = 'itest-secret-access-key-not-real-000000000';

const s3Objects = new Map<string, Buffer>();
vi.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: unknown) => {
  if (command instanceof PutObjectCommand) {
    s3Objects.set(command.input.Key!, Buffer.from(command.input.Body as Uint8Array));
    return {};
  }
  if (command instanceof DeleteObjectsCommand) {
    for (const o of command.input.Delete?.Objects ?? []) s3Objects.delete(o.Key!);
    return {};
  }
  throw new Error('unexpected S3 command');
}) as never);

type NotifyEvent = { action: string; [k: string]: unknown };
const lambdaEvents: NotifyEvent[] = [];
vi.spyOn(LambdaClient.prototype, 'send').mockImplementation((async (command: {
  input: { FunctionName?: string; InvocationType?: string; Payload?: Uint8Array };
}) => {
  expect(command.input.FunctionName).toBe('plate2home-notify');
  expect(command.input.InvocationType).toBe('Event');
  lambdaEvents.push(JSON.parse(Buffer.from(command.input.Payload!).toString('utf8')));
  return { StatusCode: 202 };
}) as never);

// Cloudflare's test secret; the siteverify call itself is stubbed below (no network flakiness).
process.env.TURNSTILE_SECRET_KEY ??= '1x0000000000000000000000000000000AA';
process.env.IP_HASH_SECRET ??= randomBytes(32).toString('base64url');
delete process.env.APP_ORIGIN;
// Admin area (D-080): a test password, hashed like npm run admin:password does.
const ADMIN_PASSWORD = 'itest-admin-password-123';
process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD_HASH = hashSync(ADMIN_PASSWORD, {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

const ORIGIN = 'http://localhost:3000';
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
let turnstileOk = true;

// Google sign-in (D-085) reads the request's cookies, which only exist inside Next. These
// tests post signed out, like most users; accounts are covered by supabase/tests.
vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  currentUser: async () => null,
}));

const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://challenges.cloudflare.com/')) {
    return Promise.resolve(Response.json({ success: turnstileOk, hostname: 'example.com' }));
  }
  return realFetch(input, init);
});

// Unusual letters + random number so earlier runs or real data can't interfere.
const number = String(1000 + Math.floor(Math.random() * 8999));
const plate = { type: 'car', letters: 'ฬฮ', number, provinceCode: 'TH-10' };
const createdBatches: string[] = [];

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-real-ip': IP, ...headers },
    body: JSON.stringify(body),
  });
}

const noParams = { params: Promise.resolve({}) };

async function crop(): Promise<Blob> {
  const png = await sharp({
    create: { width: 420, height: 180, channels: 3, background: { r: 250, g: 250, b: 245 } },
  })
    .png()
    .toBuffer();
  return new Blob([new Uint8Array(png)], { type: 'image/png' });
}

describe.skipIf(!configured)('lost → found → match (real Postgres)', () => {
  let routes: {
    lost: typeof import('@/app/api/lost/route');
    batch: typeof import('@/app/api/found/batch/route');
    plate: typeof import('@/app/api/found/batch/[id]/plate/route');
    search: typeof import('@/app/api/search/route');
    lostCheck: typeof import('@/app/api/lost-check/route');
    reveal: typeof import('@/app/api/reveal/route');
    revealOwner: typeof import('@/app/api/reveal-owner/route');
    myPosts: typeof import('@/app/api/my-posts/route');
    manage: typeof import('@/app/api/manage/route');
    report: typeof import('@/app/api/report/route');
    feedback: typeof import('@/app/api/feedback/route');
    adminLogin: typeof import('@/app/api/admin/login/route');
    adminAction: typeof import('@/app/api/admin/action/route');
  };
  let db: typeof import('@/lib/db/server');
  let matches: typeof import('@/lib/db/matches');

  beforeAll(async () => {
    routes = {
      lost: await import('@/app/api/lost/route'),
      batch: await import('@/app/api/found/batch/route'),
      plate: await import('@/app/api/found/batch/[id]/plate/route'),
      search: await import('@/app/api/search/route'),
      lostCheck: await import('@/app/api/lost-check/route'),
      reveal: await import('@/app/api/reveal/route'),
      revealOwner: await import('@/app/api/reveal-owner/route'),
      myPosts: await import('@/app/api/my-posts/route'),
      manage: await import('@/app/api/manage/route'),
      report: await import('@/app/api/report/route'),
      feedback: await import('@/app/api/feedback/route'),
      adminLogin: await import('@/app/api/admin/login/route'),
      adminAction: await import('@/app/api/admin/action/route'),
    };
    db = await import('@/lib/db/server');
    matches = await import('@/lib/db/matches');
  });

  afterAll(async () => {
    if (!configured || createdBatches.length === 0) return;
    await db.query('delete from public.batches where id = any ($1::uuid[])', [createdBatches]);
    await db.query(
      `delete from public.pending_storage_deletes
       where split_part(path, '/', 1) = any ($1::text[])`,
      [createdBatches],
    );
    await db.db().end();
  });

  const contact = { lineId: 'itest.owner' };
  const ownerEmail = `itest.${number}@example.com`;
  let ownerKey = '';
  const base = {
    consent: true,
    consentVersion: CONSENT_VERSION,
    locale: 'th',
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  };

  let lostMatchCount = -1;
  let batchId = '';
  let uploadToken = '';
  let matchId = '';
  let foundPostId = '';
  let lostPostId = '';
  let lostBatchId = '';
  let lostDeviceToken = '';
  let finderDeviceToken = '';

  it('creates a lost watch (no matches yet) and asks SNS to confirm email alerts', async () => {
    const res = await routes.lost.POST(
      jsonRequest('/api/lost', {
        ...base,
        plate,
        contact: { ...contact, email: ownerEmail },
        notifyEmail: true,
        note: 'ป้ายหลัง มีสติกเกอร์',
      }),
      noParams,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    createdBatches.push(body.batchId);
    lostPostId = body.postId;
    lostBatchId = body.batchId;
    lostDeviceToken = body.deviceToken;
    expect(body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.formatStatus).toBe('valid');
    lostMatchCount = body.matches.length;
    expect(lostMatchCount).toBe(0);
    expect(body.alertsPending).toBe(true);

    const subscribe = lambdaEvents.find((e) => e.action === 'subscribe');
    expect(subscribe).toMatchObject({ action: 'subscribe', email: ownerEmail });
    ownerKey = subscribe!.ownerKey as string;
    expect(ownerKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tells a finder checking plates that someone is looking, and nothing more', async () => {
    const check = async (p: object) => {
      const res = await routes.lostCheck.POST(
        jsonRequest('/api/lost-check', { plate: p }),
        noParams,
      );
      expect(res.status).toBe(200);
      return res.json();
    };
    const exact = await check(plate);
    expect(exact).toEqual({ match: 'exact' });
    expect((await check({ ...plate, letters: 'ฬ?' })).match).toBe('near');
    expect((await check({ ...plate, number: '1' })).match).toBeNull();
  });

  it('rejects a failed Turnstile check', async () => {
    turnstileOk = false;
    const res = await routes.lost.POST(
      jsonRequest('/api/lost', { ...base, plate, contact }),
      noParams,
    );
    turnstileOk = true;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'turnstile_failed' });
  });

  it('rejects invalid input with field codes', async () => {
    const res = await routes.lost.POST(
      jsonRequest('/api/lost', { ...base, plate, contact: { phone: '123' } }),
      noParams,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields).toMatchObject({ 'contact.phone': 'phone_invalid' });
  });

  it('opens a found batch', async () => {
    const res = await routes.batch.POST(
      jsonRequest('/api/found/batch', {
        ...base,
        contact: { phone: '0812345678' },
        handover: 'police_station',
        policeStationNote: 'สภ.ทดสอบ',
        district: 'บางเขน',
        note: 'เจอใกล้วัด ทั้งป้ายหน้าและหลัง',
      }),
      noParams,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    batchId = body.batchId;
    uploadToken = body.uploadToken;
    finderDeviceToken = body.deviceToken;
    createdBatches.push(batchId);
  });

  it('refuses a plate upload with a wrong upload token', async () => {
    const form = new FormData();
    form.set('data', JSON.stringify({ plate }));
    form.set('crop', await crop(), 'crop.png');
    const res = await routes.plate.POST(
      new Request(`${ORIGIN}/api/found/batch/${batchId}/plate`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-real-ip': IP, 'x-upload-token': 'A'.repeat(43) },
        body: form,
      }),
      { params: Promise.resolve({ id: batchId }) },
    );
    expect(res.status).toBe(403);
  });

  it('uploads the found plate and matches the lost watch instantly', async () => {
    const form = new FormData();
    form.set('data', JSON.stringify({ plate }));
    form.set('crop', await crop(), 'crop.png');
    const res = await routes.plate.POST(
      new Request(`${ORIGIN}/api/found/batch/${batchId}/plate`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'x-real-ip': IP, 'x-upload-token': uploadToken },
        body: form,
      }),
      { params: Promise.resolve({ id: batchId }) },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('active');
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].kind).toBe('exact');
    matchId = body.matches[0].matchId;
    foundPostId = body.postId;

    // The stored crop (S3 key <batch>/<post>.webp) is a re-encoded WebP.
    const stored = s3Objects.get(`${batchId}/${body.postId}.webp`);
    expect(stored).toBeDefined();
    expect((await sharp(stored!).metadata()).format).toBe('webp');
  });

  it('alerts the opted-in owner through the notify Lambda, once, and marks the match', async () => {
    const notify = lambdaEvents.filter((e) => e.action === 'notify');
    expect(notify).toHaveLength(1);
    expect(notify[0]!.alerts).toEqual([
      { matchId, ownerKey, plate: expect.any(String), locale: 'th' },
    ]);
    // Only the hash travels with alerts, never the email.
    expect(JSON.stringify(notify[0])).not.toContain(ownerEmail);
    const { data } = await db.query<{ notified_at: string | null }>(
      'select notified_at from public.matches where id = $1',
      [matchId],
    );
    expect(data![0]!.notified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('finds the found plate by search, with a signed crop URL and no contact data', async () => {
    const res = await routes.search.POST(
      jsonRequest('/api/search', { plate: { ...plate, letters: 'ฬ?' } }),
      noParams,
    );
    expect(res.status).toBe(200);
    const { results } = await res.json();
    const hit = results.find((r: { plate: { number: string } }) => r.plate.number === number);
    expect(hit).toBeDefined();
    expect(hit.kind).toBe('near'); // wildcard → never exact
    expect(hit.cropUrl).toMatch(
      /^https:\/\/plate2home-itest\.s3\.us-east-1\.amazonaws\.com\/.+X-Amz-Signature=/,
    );
    const text = JSON.stringify(results);
    expect(text).not.toContain('0812345678');
    expect(text).not.toContain('itest.owner');
    expect(text).not.toContain('บางเขน');
  });

  it('never returns lost watches in search', async () => {
    const res = await routes.search.POST(jsonRequest('/api/search', { plate }), noParams);
    const { results } = await res.json();
    for (const r of results) expect(r.cropUrl).not.toBeNull();
  });

  it('exposes the match view without contact details', async () => {
    const view = await matches.getMatchView(matchId);
    expect(view).toMatchObject({
      kind: 'exact',
      lostPlate: { letters: 'ฬฮ', number },
      found: { handover: 'police_station' },
      lostNote: 'ป้ายหลัง มีสติกเกอร์',
    });
    expect(JSON.stringify(view)).not.toContain('0812345678');
    expect(JSON.stringify(view)).not.toContain('เจอใกล้วัด');
  });

  const revealBody = (postId: string, extra: Record<string, unknown> = {}) => ({
    postId,
    acknowledged: true,
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    ...extra,
  });

  it('reveals the finder contact, district and note after the acknowledgement', async () => {
    const res = await routes.reveal.POST(
      jsonRequest('/api/reveal', revealBody(foundPostId)),
      noParams,
    );
    expect(res.status).toBe(200);
    const { contact } = await res.json();
    expect(contact).toMatchObject({
      phone: '0812345678',
      lineId: null,
      email: null,
      handover: 'police_station',
      policeStationNote: 'สภ.ทดสอบ',
      district: 'บางเขน',
      note: 'เจอใกล้วัด ทั้งป้ายหน้าและหลัง',
    });
  });

  it("never reveals a lost-plate owner's contact through this endpoint", async () => {
    const res = await routes.reveal.POST(
      jsonRequest('/api/reveal', revealBody(lostPostId)),
      noParams,
    );
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('itest.owner');
  });

  it('requires the safety acknowledgement', async () => {
    const res = await routes.reveal.POST(
      jsonRequest('/api/reveal', revealBody(foundPostId, { acknowledged: false })),
      noParams,
    );
    expect(res.status).toBe(400);
  });

  it('rejects notes with payment details', async () => {
    const res = await routes.lost.POST(
      jsonRequest('/api/lost', { ...base, plate, contact, note: 'โอนมา 123-4-56789-0' }),
      noParams,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toMatchObject({ note: 'text_account_number' });
  });

  it('lists the owner posts and their matches for this device (My posts)', async () => {
    const res = await routes.myPosts.POST(
      jsonRequest('/api/my-posts', { devices: [{ batchId: lostBatchId, token: lostDeviceToken }] }),
      noParams,
    );
    expect(res.status).toBe(200);
    const { posts } = await res.json();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ postId: lostPostId, kind: 'lost' });
    expect(posts[0].matches.map((m: { matchId: string }) => m.matchId)).toContain(matchId);
    expect(JSON.stringify(posts)).not.toContain('itest.owner');
  });

  it('shows nothing for a wrong device token', async () => {
    const res = await routes.myPosts.POST(
      jsonRequest('/api/my-posts', { devices: [{ batchId: lostBatchId, token: 'B'.repeat(43) }] }),
      noParams,
    );
    expect((await res.json()).posts).toEqual([]);
  });

  it("gives the matched finder the owner's contact, and refuses the owner's own token", async () => {
    const ok = await routes.revealOwner.POST(
      jsonRequest('/api/reveal-owner', { matchId, token: finderDeviceToken }),
      noParams,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).contact).toMatchObject({ lineId: 'itest.owner' });

    const refused = await routes.revealOwner.POST(
      jsonRequest('/api/reveal-owner', { matchId, token: lostDeviceToken }),
      noParams,
    );
    expect(refused.status).toBe(404);
  });

  // --- Reports, feedback, admin (D-080) -------------------------------------------------------
  it('takes a report on the found post (once per IP) and needs Turnstile', async () => {
    const send = (turnstileToken = 'XXXX.DUMMY.TOKEN.XXXX') =>
      routes.report.POST(
        jsonRequest('/api/report', {
          postId: foundPostId,
          reason: 'other',
          note: 'itest report',
          turnstileToken,
        }),
        noParams,
      );
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200); // a repeat is accepted but not counted twice
    turnstileOk = false;
    const refused = await send();
    turnstileOk = true;
    expect(refused.status).toBe(403);
  });

  it('stores feedback and validates the rating', async () => {
    const ok = await routes.feedback.POST(
      jsonRequest('/api/feedback', {
        rating: 4,
        comment: 'itest feedback',
        locale: 'th',
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      }),
      noParams,
    );
    expect(ok.status).toBe(201);
    const bad = await routes.feedback.POST(
      jsonRequest('/api/feedback', { rating: 9, locale: 'th', turnstileToken: 'x' }),
      noParams,
    );
    expect(bad.status).toBe(400);
  });

  it('keeps admin actions behind the password session', async () => {
    const act = (cookie?: string) =>
      routes.adminAction.POST(
        jsonRequest(
          '/api/admin/action',
          { action: 'hide', postId: foundPostId },
          cookie ? { cookie } : {},
        ),
        noParams,
      );
    expect((await act()).status).toBe(401);
    expect((await act('p2h_admin=1.2.3')).status).toBe(401);

    const wrong = await routes.adminLogin.POST(
      jsonRequest('/api/admin/login', { password: 'nope' }),
      noParams,
    );
    expect(wrong.status).toBe(403);

    const login = await routes.adminLogin.POST(
      jsonRequest('/api/admin/login', { password: ADMIN_PASSWORD }),
      noParams,
    );
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('HttpOnly');
    const cookie = setCookie.split(';')[0]!;

    expect((await act(cookie)).status).toBe(200);
    const restore = await routes.adminAction.POST(
      jsonRequest('/api/admin/action', { action: 'restore', postId: foundPostId }, { cookie }),
      noParams,
    );
    expect(restore.status).toBe(200);
  });

  it('refuses terms the user has not seen (an outdated consent version)', async () => {
    const res = await routes.lost.POST(
      jsonRequest('/api/lost', { ...base, consentVersion: '2000-01-v0', plate, contact }),
      noParams,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: 'consent_outdated' });
  });

  // --- Manage (D-078, D-085) ------------------------------------------------------------------
  const manage = (body: object) => routes.manage.POST(jsonRequest('/api/manage', body), noParams);
  const ownerDevice = () => ({ kind: 'device', batchId: lostBatchId, token: lostDeviceToken });

  it('asks a signed-out user to sign in to manage by account', async () => {
    const res = await manage({ auth: { kind: 'account', batchId: lostBatchId }, action: 'list' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'signed_out' });
  });

  it('opens the post with the device token, without contact details', async () => {
    const res = await manage({ auth: ownerDevice(), action: 'list' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batchId).toBe(lostBatchId);
    expect(body.posts).toEqual([expect.objectContaining({ postId: lostPostId, status: 'active' })]);
    expect(JSON.stringify(body)).not.toContain('itest.owner');
  });

  it('extends and resolves with the device token, and refuses a wrong one', async () => {
    const extended = await manage({ auth: ownerDevice(), action: 'extend', postId: lostPostId });
    const [post] = (await extended.json()).posts;
    expect(Date.parse(post.expiresAt) - Date.parse(post.createdAt)).toBeGreaterThan(
      89 * 86_400_000,
    );

    const bad = await manage({
      auth: { kind: 'device', batchId: lostBatchId, token: 'B'.repeat(43) },
      action: 'resolve',
    });
    expect(bad.status).toBe(404);

    const resolved = await manage({ auth: ownerDevice(), action: 'resolve', postId: lostPostId });
    expect((await resolved.json()).posts[0].status).toBe('resolved');

    // Resolving stops the alerts: the prune keep-list no longer has this owner's key.
    await vi.waitFor(() => expect(lambdaEvents.some((e) => e.action === 'prune')).toBe(true));
    const prune = lambdaEvents.filter((e) => e.action === 'prune').at(-1)!;
    expect(prune.keep).not.toContain(ownerKey);
  });

  it("deletes the finder's plate with their device token", async () => {
    const res = await manage({
      auth: { kind: 'device', batchId, token: finderDeviceToken },
      action: 'delete',
      postId: foundPostId,
    });
    expect(res.status).toBe(200);
    const left = (await res.json()).posts.map((p: { postId: string }) => p.postId);
    expect(left).not.toContain(foundPostId);
  });
});
