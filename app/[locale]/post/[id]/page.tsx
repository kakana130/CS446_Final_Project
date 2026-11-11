import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PlateView } from '@/components/plate/PlateView';
import { ReportButton } from '@/components/report/ReportButton';
import { RevealContact } from '@/components/reveal/RevealContact';
import { PageShell } from '@/components/site/PageShell';
import { getFoundPost } from '@/lib/db/found-post';
import { signCropUrls } from '@/lib/db/storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('post');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** A found plate: photo, plate, when, where it is now, and the contact-reveal checkpoint. */
export default async function FoundPostPage({ params }: PageProps<'/[locale]/post/[id]'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const post = await getFoundPost(id);
  if (!post) notFound();

  const t = await getTranslations('post');
  const format = await getFormatter();
  const urls = post.cropPath ? await signCropUrls([post.cropPath]) : new Map<string, string>();
  const cropUrl = post.cropPath ? urls.get(post.cropPath) : undefined;

  return (
    <PageShell title={t('title')}>
      <div className="space-y-5">
        {cropUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the optimizer
          <img
            src={cropUrl}
            alt={t('cropAlt')}
            className="max-h-64 w-full rounded-sm border-2 border-line object-contain"
          />
        )}
        <PlateView plate={post.plate} size="md" />
        <p className="text-ink-muted">
          {t('foundAt', { when: format.relativeTime(new Date(post.createdAt), new Date()) })}
          {post.handover && (
            <>
              {' · '}
              {post.handover === 'police_station' ? t('atPolice') : t('withFinder')}
            </>
          )}
        </p>
        <p>{t('compare')}</p>
        <RevealContact postId={post.postId} />
        <div className="border-t-2 border-line-soft pt-2">
          <ReportButton postId={post.postId} />
        </div>
      </div>
    </PageShell>
  );
}
