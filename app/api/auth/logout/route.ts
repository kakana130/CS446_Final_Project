import { apiRoute } from '@/lib/api/route';
import { signOut } from '@/lib/auth/session';

/** Sign out on this device (the session cookie is cleared). */
export const POST = apiRoute('api/auth/logout', async () => {
  await signOut();
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
});
