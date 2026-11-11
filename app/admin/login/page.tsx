import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminLogin } from '@/components/admin/AdminLogin';
import { ADMIN_COOKIE, adminConfigured, verifySessionToken } from '@/lib/admin/session';

export default async function AdminLoginPage() {
  const t = await getTranslations({ locale: 'th', namespace: 'admin' });
  if (verifySessionToken((await cookies()).get(ADMIN_COOKIE)?.value)) redirect('/admin');
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-10">
      <h1 className="text-2xl font-bold">{t('loginTitle')}</h1>
      {adminConfigured() ? <AdminLogin /> : <p>{t('notConfigured')}</p>}
    </div>
  );
}
