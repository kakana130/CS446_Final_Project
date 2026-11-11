import { ApiError, apiRoute, enforceRateLimit, readJson } from '@/lib/api/route';
import { submitFeedback } from '@/lib/db/admin';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { feedbackSchema } from '@/lib/validation/schemas';

/** Feedback: 1–5 stars and an optional comment (D-080). */
export const POST = apiRoute('api/feedback', async (request, { ip, ipHash }) => {
  const body = feedbackSchema.parse(await readJson(request));
  await enforceRateLimit('feedback', ipHash);
  if (!(await verifyTurnstile(body.turnstileToken, 'feedback', ip))) {
    throw new ApiError('turnstile_failed', 403);
  }
  await submitFeedback(body.rating, body.comment, body.context, body.locale, ipHash);
  return Response.json({ ok: true }, { status: 201, headers: { 'cache-control': 'no-store' } });
});
