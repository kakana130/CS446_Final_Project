import { ApiError, apiRoute, enforceRateLimit, readJson } from '@/lib/api/route';
import { reportPost } from '@/lib/db/admin';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { reportSchema } from '@/lib/validation/schemas';

/** Report a post (D-080). One report per post per IP; three reporters hide it for review. */
export const POST = apiRoute('api/report', async (request, { ip, ipHash }) => {
  const body = reportSchema.parse(await readJson(request));
  await enforceRateLimit('report', ipHash);
  if (!(await verifyTurnstile(body.turnstileToken, 'report', ip))) {
    throw new ApiError('turnstile_failed', 403);
  }
  const result = await reportPost(body.postId, body.reason, body.note, ipHash);
  if (result === 'not_found') throw new ApiError('not_found', 404);
  // A repeat report is fine from the user's point of view: it is already on record.
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
});
