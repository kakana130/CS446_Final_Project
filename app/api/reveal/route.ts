import { ApiError, apiRoute, assertSiteActive, enforceRateLimit, readJson } from '@/lib/api/route';
import { revealFoundContact } from '@/lib/db/found-post';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { revealSchema } from '@/lib/validation/schemas';

/**
 * Contact reveal (spec §3.5): after the anti-scam acknowledgement and Turnstile, return the
 * finder's contact for an active found post. Every reveal is logged with a hashed IP.
 * Lost-plate owners' contacts are never revealed here (D-002).
 */
export const POST = apiRoute('api/reveal', async (request, { ip, ipHash }) => {
  await assertSiteActive();
  const body = revealSchema.parse(await readJson(request));
  await enforceRateLimit('reveal', ipHash);
  await enforceRateLimit('reveal:post', body.postId);
  if (!(await verifyTurnstile(body.turnstileToken, 'reveal', ip))) {
    throw new ApiError('turnstile_failed', 403);
  }
  const contact = await revealFoundContact(body.postId, ipHash);
  if (!contact) throw new ApiError('not_found', 404);
  return Response.json({ contact }, { headers: { 'cache-control': 'no-store' } });
});
