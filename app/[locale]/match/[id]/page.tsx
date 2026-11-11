import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PlateView } from '@/components/plate/PlateView';
import { ReportButton } from '@/components/report/ReportButton';
import { MatchContact } from '@/components/reveal/MatchContact';
import { PageShell } from '@/components/site/PageShell';
import { Alert } from '@/components/ui/Alert';
import { getMatchCounts, getMatchView } from '@/lib/db/matches';
import { signCropUrls } from '@/lib/db/storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('match');
  // Match pages are reachable only by link; keep them out of search engines.
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * Match page: the owner's lost plate next to the found plate and its photo. No contact
 * details or district here: those come through the anti-scam reveal flow (Phase 4).
 */
export default async function MatchPage({ params }: PageProps<'/[locale]/match/[id]'>) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const view = await getMatchView(id);
  if (!view) notFound();
  const counts = await getMatchCounts(id);

  const t = await getTranslations('match');
  const tn = await getTranslations('note');
  const format = await getFormatter();
  const urls = view.found.cropPath ? await signCropUrls([view.found.cropPath]) : new Map();
  const cropUrl = view.found.cropPath ? urls.get(view.found.cropPath) : undefined;

  return (
    <PageShell title={t('title')}>
      <div className="space-y-6">
        <Alert tone="highlight" title={view.kind === 'exact' ? t('exactTitle') : t('nearTitle')}>
          {view.kind === 'near' && <p>{t('nearBody')}</p>}
        </Alert>

        <section aria-labelledby="found-h" className="space-y-3">
          <h2 id="found-h" className="text-lg font-bold">
            {t('foundLabel')}
          </h2>
          {cropUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, must not be cached by the optimizer
            <img
              src={cropUrl}
              alt={t('cropAlt')}
              className="max-h-60 w-full rounded-sm border-2 border-line object-contain"
            />
          )}
          <PlateView plate={view.found.plate} size="md" />
          <p className="text-ink-muted">
            {t('foundAt', {
              when: format.relativeTime(new Date(view.found.createdAt), new Date()),
            })}
            {view.found.handover && (
              <>
                {' · '}
                {view.found.handover === 'police_station' ? t('atPolice') : t('withFinder')}
              </>
            )}
          </p>
        </section>

        <section aria-labelledby="lost-h" className="space-y-3">
          <h2 id="lost-h" className="text-lg font-bold">
            {t('lostLabel')}
          </h2>
          <PlateView plate={view.lostPlate} size="md" />
          {view.lostNote && (
            <div className="rounded-md border-2 border-line-soft bg-surface p-3">
              <p className="font-semibold">{tn('ownerNote')}</p>
              <p className="whitespace-pre-line">{view.lostNote}</p>
            </div>
          )}
        </section>

        <MatchContact
          matchId={view.matchId}
          foundPostId={view.found.postId}
          foundBatchId={view.foundBatchId}
          lostBatchId={view.lostBatchId}
          owners={counts.owners}
          finders={counts.finders}
        />
        <div className="border-t-2 border-line-soft pt-2">
          <ReportButton postId={view.found.postId} />
        </div>
      </div>
    </PageShell>
  );
}
