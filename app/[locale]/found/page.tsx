import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { FoundFlow } from '@/components/flows/FoundFlow';
import { PageShell } from '@/components/site/PageShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('found');
  return { title: t('title') };
}

export default async function FoundPage() {
  const t = await getTranslations('found');
  return (
    <PageShell title={t('title')}>
      <Suspense>
        <FoundFlow />
      </Suspense>
    </PageShell>
  );
}
