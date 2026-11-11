import { ApiError, apiRoute, assertSiteActive, enforceRateLimit, readJson } from '@/lib/api/route';
import { currentUser } from '@/lib/auth/session';
import { CONSENT_VERSION } from '@/lib/config/app';
import { myPosts } from '@/lib/db/mine';
import { createLostWatch } from '@/lib/db/posting';
import { logError } from '@/lib/log';
import { matchNewPost } from '@/lib/matching/run';
import { alertsConfigured, subscribeOwner } from '@/lib/notify';
import { buildPlateRecord } from '@/lib/plate/canonical';
import { samePlate } from '@/lib/plate/same';
import { randomToken, sha256Hex } from '@/lib/security/tokens';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { lostCreateSchema } from '@/lib/validation/schemas';

/** Posts that still count as reported (a resolved one can be reported again). */
const LIVE = ['active', 'needs_review', 'hidden'];

/** Create a standing watch for a lost plate, then match it against found posts instantly. */
export const POST = apiRoute('api/lost', async (request, { ip, ipHash }) => {
  await assertSiteActive();
  const body = lostCreateSchema.parse(await readJson(request));
  if (body.consentVersion !== CONSENT_VERSION) throw new ApiError('consent_outdated', 409);

  await enforceRateLimit('lost:create', ipHash);

  const record = buildPlateRecord(body.plate);
  // One report per plate per account (D-091); the browser also checks this device's posts.
  const user = await currentUser();
  if (user) {
    const mine = await myPosts([], user.id);
    if (
      mine.some(
        (p) => p.kind === 'lost' && LIVE.includes(p.status) && samePlate(p.plate, record.plate),
      )
    ) {
      throw new ApiError('already_reported', 409);
    }
  }

  if (!(await verifyTurnstile(body.turnstileToken, 'lost_create', ip))) {
    throw new ApiError('turnstile_failed', 403);
  }

  // Alerts by email through Amazon SNS. SNS emails a confirmation link first (double opt-in).
  const alertEmail = body.notifyEmail && alertsConfigured() ? body.contact.email : null;

  const deviceToken = randomToken();
  const { batchId, postId } = await createLostWatch({
    record,
    contact: body.contact,
    ownerId: user?.id ?? null,
    deviceTokenHash: sha256Hex(deviceToken),
    locale: body.locale,
    consentVersion: CONSENT_VERSION,
    notifyEmail: alertEmail !== null,
    note: body.note || null,
  });

  if (alertEmail) {
    try {
      await subscribeOwner(alertEmail);
    } catch (err) {
      logError('api/lost:subscribe', err);
    }
  }

  // The watch exists now; a matching failure must not fail the request (the daily safety-net
  // run will pick it up).
  let matches: { matchId: string; kind: string }[] = [];
  try {
    matches = (await matchNewPost({ id: postId, kind: 'lost', record })).map((m) => ({
      matchId: m.matchId,
      kind: m.kind,
    }));
  } catch (err) {
    logError('api/lost:match', err);
  }

  return Response.json(
    {
      batchId,
      postId,
      deviceToken,
      formatStatus: record.validation.status,
      matches,
      alertsPending: alertEmail !== null,
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
});
