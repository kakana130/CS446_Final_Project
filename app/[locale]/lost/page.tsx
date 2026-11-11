import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LostFlow } from '@/components/flows/LostFlow';
import { PageShell } from '@/components/site/PageShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('lost');
  return { title: t('title') };
}

export default async function LostPage() {
  const t = await getTranslations('lost');
  return (
    <PageShell title={t('title')}>
      <Suspense>
        <LostFlow />
      </Suspense>
    </PageShell>
  );
}
