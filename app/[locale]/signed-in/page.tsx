import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SignedInNotice } from '@/components/auth/SignedInNotice';
import { PageShell } from '@/components/site/PageShell';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<Metadata> {
  const failed = (await searchParams).error !== undefined;
  const t = await getTranslations('account');
  return {
    title: t(failed ? 'failedTitle' : 'doneTitle'),
    robots: { index: false, follow: false },
  };
}

/** Where the Google sign-in window lands (D-085): tell the opener, then close. */
export default async function SignedInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const failed = (await searchParams).error !== undefined;
  const t = await getTranslations('account');
  return (
    <PageShell title={t(failed ? 'failedTitle' : 'doneTitle')}>
      <SignedInNotice failed={failed} />
    </PageShell>
  );
}
