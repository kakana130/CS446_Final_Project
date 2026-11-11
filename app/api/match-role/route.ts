import { apiRoute, enforceRateLimit, readJson } from '@/lib/api/route';
import { currentUser } from '@/lib/auth/session';
import { matchRoles } from '@/lib/db/mine';
import { matchRoleSchema } from '@/lib/validation/schemas';

/**
 * On a match page, a signed-in account learns whether it posted the found plate (then it may
 * see the owner's contact) or the lost one (D-085). Without a session: neither.
 */
export const POST = apiRoute('api/match-role', async (request, { ipHash }) => {
  const body = matchRoleSchema.parse(await readJson(request));
  await enforceRateLimit('my-posts', ipHash);
  const user = await currentUser();
  const roles = user ? await matchRoles(body.matchId, user.id) : { finder: false, owner: false };
  return Response.json(roles, { headers: { 'cache-control': 'no-store' } });
});
