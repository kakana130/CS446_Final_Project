import { apiRoute, assertSiteActive, enforceRateLimit, readJson } from '@/lib/api/route';
import { buildPlateRecord } from '@/lib/plate/canonical';
import { lostWatchStatus } from '@/lib/search/lost';
import { searchSchema } from '@/lib/validation/schemas';

/**
 * While a finder checks plates (found flow, step 1): does a lost watch match this plate?
 * Returns only `exact` / `near` / null (D-064). POST so plates stay out of URLs and logs.
 */
export const POST = apiRoute('api/lost-check', async (request, { ipHash }) => {
  await assertSiteActive();
  const body = searchSchema.parse(await readJson(request));
  await enforceRateLimit('lost-check', ipHash);
  const match = await lostWatchStatus(buildPlateRecord(body.plate));
  return Response.json({ match }, { headers: { 'cache-control': 'no-store' } });
});
