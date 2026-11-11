import { apiRoute } from '@/lib/api/route';
import {
  clearedSessionCookie,
  isSecureRequest,
  sessionFromRequest,
  verifySessionToken,
} from '@/lib/admin/session';
import { adminLog } from '@/lib/db/admin';
import { serverEnv } from '@/lib/env/server';

export const POST = apiRoute('api/admin/logout', async (request) => {
  if (verifySessionToken(sessionFromRequest(request))) await adminLog('logout');
  const secure = isSecureRequest(request, serverEnv().APP_ORIGIN);
  return Response.json(
    { ok: true },
    { headers: { 'cache-control': 'no-store', 'set-cookie': clearedSessionCookie(secure) } },
  );
});
