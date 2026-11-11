import { ApiError, apiRoute, assertSiteActive, enforceRateLimit, readJson } from '@/lib/api/route';
import { currentUser } from '@/lib/auth/session';
import { CONSENT_VERSION, UPLOAD_TOKEN_TTL_SECONDS } from '@/lib/config/app';
import { createFoundBatch } from '@/lib/db/posting';
import { randomToken, sha256Hex } from '@/lib/security/tokens';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { foundBatchSchema } from '@/lib/validation/schemas';

/**
 * Open a found batch: one contact and one Turnstile check for all plates (owned by the
 * signed-in account, if any). Returns a
 * short-lived upload token; plates are then added one per request (weak mobile data).
 */
export const POST = apiRoute('api/found/batch', async (request, { ip, ipHash }) => {
  await assertSiteActive();
  const body = foundBatchSchema.parse(await readJson(request));
  if (body.consentVersion !== CONSENT_VERSION) throw new ApiError('consent_outdated', 409);

  await enforceRateLimit('found:batch', ipHash);
  if (!(await verifyTurnstile(body.turnstileToken, 'found_batch', ip))) {
    throw new ApiError('turnstile_failed', 403);
  }

  const deviceToken = randomToken();
  const uploadToken = randomToken();
  const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_SECONDS * 1000);
  const batchId = await createFoundBatch({
    contact: body.contact,
    ownerId: (await currentUser())?.id ?? null,
    deviceTokenHash: sha256Hex(deviceToken),
    uploadTokenHash: sha256Hex(uploadToken),
    uploadTokenExpiresAt: expiresAt,
    locale: body.locale,
    consentVersion: CONSENT_VERSION,
    handover: body.handover,
    policeStationNote: body.handover === 'police_station' ? body.policeStationNote : null,
    district: body.district || null,
    note: body.note || null,
  });

  return Response.json(
    { batchId, uploadToken, deviceToken, uploadExpiresAt: expiresAt.toISOString() },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
});
