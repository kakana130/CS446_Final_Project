import { ApiError, apiRoute, assertSiteActive, enforceRateLimit, readJson } from '@/lib/api/route';
import { currentUser } from '@/lib/auth/session';
import { revealOwnerContact, revealOwnerContactForUser } from '@/lib/db/mine';
import { sha256Hex } from '@/lib/security/tokens';
import { revealOwnerSchema } from '@/lib/validation/schemas';

/**
 * The finder of a matched found post sees the lost-plate owner's contact (D-002), proven by
 * the found batch's device token or by the signed-in account that posted it (D-085). Anyone
 * else gets 404. Logged like any reveal.
 */
export const POST = apiRoute('api/reveal-owner', async (request, { ipHash }) => {
  await assertSiteActive();
  const body = revealOwnerSchema.parse(await readJson(request));
  await enforceRateLimit('reveal:owner', ipHash);
  let contact = null;
  if (body.token) {
    contact = await revealOwnerContact(body.matchId, sha256Hex(body.token), ipHash);
  } else {
    const user = await currentUser();
    if (user) contact = await revealOwnerContactForUser(body.matchId, user.id, ipHash);
  }
  if (!contact) throw new ApiError('not_found', 404);
  return Response.json({ contact }, { headers: { 'cache-control': 'no-store' } });
});
