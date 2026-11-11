import { apiRoute, assertSiteActive, enforceRateLimit, readJson } from '@/lib/api/route';
import { buildPlateRecord } from '@/lib/plate/canonical';
import { searchFoundPosts } from '@/lib/search/found';
import { searchSchema } from '@/lib/validation/schemas';

/** Search found plates. POST so plate numbers never appear in URLs or logs (D-029). */
export const POST = apiRoute('api/search', async (request, { ipHash }) => {
  await assertSiteActive();
  const body = searchSchema.parse(await readJson(request));
  await enforceRateLimit('search', ipHash);
  const results = await searchFoundPosts(buildPlateRecord(body.plate));
  return Response.json({ results }, { headers: { 'cache-control': 'no-store' } });
});
