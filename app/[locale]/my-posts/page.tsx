import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountBox } from '@/components/auth/AccountBox';
import { MyPostsList } from '@/components/flows/MyPostsList';
import { PageShell } from '@/components/site/PageShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('myPosts');
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function MyPostsPage() {
  const t = await getTranslations('myPosts');
  return (
    <PageShell title={t('title')}>
      {/* Who is signed in (or the offer to sign in) comes first, above the posts (D-103). */}
      <div className="space-y-5">
        <AccountBox context="manage" />
        <MyPostsList />
      </div>
    </PageShell>
  );
}
