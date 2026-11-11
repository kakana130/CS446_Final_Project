import { ApiError, apiRoute, enforceRateLimit, readJson } from '@/lib/api/route';
import { currentUser } from '@/lib/auth/session';
import { batchOwned, batchOwnedBy, batchPosts, managePost } from '@/lib/db/manage';
import { pruneSubscriptionsLater } from '@/lib/notify';
import { sha256Hex } from '@/lib/security/tokens';
import { manageSchema } from '@/lib/validation/schemas';

/**
 * Manage a post (D-078): list a batch's posts, mark a plate as returned, extend or delete.
 * Ownership is proven with this device's token, or by the signed-in account that owns the
 * batch (D-085). Works while the site is dormant too: people must always be able to remove
 * their data.
 */
export const POST = apiRoute('api/manage', async (request, { ipHash }) => {
  const body = manageSchema.parse(await readJson(request));
  await enforceRateLimit('manage', ipHash);

  const { batchId } = body.auth;
  let owned: boolean;
  if (body.auth.kind === 'device') {
    owned = await batchOwned(batchId, sha256Hex(body.auth.token));
  } else {
    const user = await currentUser();
    if (!user) throw new ApiError('signed_out', 401);
    owned = await batchOwnedBy(batchId, user.id);
  }
  if (!owned) throw new ApiError('not_found', 404);

  if (body.action !== 'list') await managePost(batchId, body.postId ?? null, body.action);
  // A returned or deleted lost plate stops its email alerts (Amazon SNS unsubscribe).
  if (body.action === 'resolve' || body.action === 'delete') pruneSubscriptionsLater('api/manage');
  const posts = await batchPosts(batchId);
  return Response.json({ batchId, posts }, { headers: { 'cache-control': 'no-store' } });
});
