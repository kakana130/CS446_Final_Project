import { apiRoute, enforceRateLimit, readJson } from '@/lib/api/route';
import { currentUser } from '@/lib/auth/session';
import { claimBatches, myPosts } from '@/lib/db/mine';
import { sha256Hex } from '@/lib/security/tokens';
import { myPostsSchema } from '@/lib/validation/schemas';

/**
 * "My posts": posts created on this device (device tokens from localStorage) and, when signed
 * in, every post of the account. Signing in links this device's posts to the account, so
 * they show up on other devices too (D-085).
 */
export const POST = apiRoute('api/my-posts', async (request, { ipHash }) => {
  const body = myPostsSchema.parse(await readJson(request));
  await enforceRateLimit('my-posts', ipHash);
  const devices = body.devices.map((d) => ({ batchId: d.batchId, tokenHash: sha256Hex(d.token) }));
  const user = await currentUser();
  if (user) await claimBatches(user.id, devices);
  const posts = await myPosts(devices, user?.id ?? null);
  return Response.json(
    { posts, signedIn: user !== null },
    { headers: { 'cache-control': 'no-store' } },
  );
});
