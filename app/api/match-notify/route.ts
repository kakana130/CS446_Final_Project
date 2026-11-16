import { z } from 'zod';
import { ApiError, apiRoute, assertSiteActive, enforceRateLimit, readJson } from '@/lib/api/route';
import { claimMatchNotify } from '@/lib/db/alerts';
import { alertsConfigured, notifyMatchNow } from '@/lib/notify';

const bodySchema = z.object({ matchId: z.uuid() });

/**
 * "Match Now!" on a match page: Amazon SNS emails both sides of the match again (owner and
 * finder, each with the other's contact). At most once every 5 seconds per match, plus a
 * per-IP limit. The match id is the only input; the page itself is reachable only by link.
 */
export const POST = apiRoute('api/match-notify', async (request, { ipHash }) => {
  await assertSiteActive();
  const { matchId } = bodySchema.parse(await readJson(request));
  if (!alertsConfigured()) throw new ApiError('alerts_off', 503);
  await enforceRateLimit('match:notify', ipHash);

  const claim = await claimMatchNotify(matchId);
  if (claim === 'missing') throw new ApiError('not_found', 404);
  if (claim === 'wait') throw new ApiError('too_soon', 429);

  const recipients = await notifyMatchNow(matchId);
  return Response.json({ recipients }, { headers: { 'cache-control': 'no-store' } });
});
