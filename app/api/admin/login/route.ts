import { ApiError, apiRoute, enforceRateLimit, readJson } from '@/lib/api/route';
import {
  adminConfigured,
  checkAdminPassword,
  createSessionToken,
  isSecureRequest,
  sessionCookie,
} from '@/lib/admin/session';
import { adminLog } from '@/lib/db/admin';
import { serverEnv } from '@/lib/env/server';
import { adminLoginSchema } from '@/lib/validation/schemas';

/**
 * Admin login (D-080): password checked against the argon2id hash in the environment,
 * rate limited per IP and for everyone together; every attempt is logged.
 */
export const POST = apiRoute('api/admin/login', async (request, { ipHash }) => {
  if (!adminConfigured()) throw new ApiError('not_found', 404);
  const body = adminLoginSchema.parse(await readJson(request));
  await enforceRateLimit('admin:login', ipHash);
  await enforceRateLimit('admin:login-all', 'all');

  if (!(await checkAdminPassword(body.password))) {
    await adminLog('login_failed', { ip: ipHash.slice(0, 8) });
    throw new ApiError('admin_password_wrong', 403);
  }
  await adminLog('login_ok', { ip: ipHash.slice(0, 8) });
  const secure = isSecureRequest(request, serverEnv().APP_ORIGIN);
  return Response.json(
    { ok: true },
    {
      headers: {
        'cache-control': 'no-store',
        'set-cookie': sessionCookie(createSessionToken(), secure),
      },
    },
  );
});
