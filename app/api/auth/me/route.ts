import { apiRoute } from '@/lib/api/route';
import { currentUser } from '@/lib/auth/session';

/** Who is signed in: the email (shown, and to prefill the contact form) and Google picture. */
export const GET = apiRoute('api/auth/me', async () => {
  const user = await currentUser();
  return Response.json(
    { user: user && { email: user.email, avatarUrl: user.avatarUrl } },
    { headers: { 'cache-control': 'no-store' } },
  );
});
