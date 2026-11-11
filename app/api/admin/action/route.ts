import { ApiError, apiRoute, readJson } from '@/lib/api/route';
import { sessionFromRequest, verifySessionToken } from '@/lib/admin/session';
import { adminPostAction, adminSetMode } from '@/lib/db/admin';
import { pruneSubscriptionsLater } from '@/lib/notify';
import { adminActionSchema } from '@/lib/validation/schemas';

/** Admin actions (D-080): hide/restore/delete a post, dismiss its reports, or pause the site. */
export const POST = apiRoute('api/admin/action', async (request) => {
  if (!verifySessionToken(sessionFromRequest(request))) throw new ApiError('admin_login', 401);
  const body = adminActionSchema.parse(await readJson(request));
  if (body.action === 'mode') await adminSetMode(body.mode);
  else {
    await adminPostAction(body.action, body.postId);
    if (body.action === 'delete' || body.action === 'hide') pruneSubscriptionsLater('api/admin');
  }
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
});
