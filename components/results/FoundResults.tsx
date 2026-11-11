'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { PlateView } from '@/components/plate/PlateView';
import { ReportButton } from '@/components/report/ReportButton';
import { RevealContact } from '@/components/reveal/RevealContact';
import { textLink } from '@/components/ui/styles';
import { Link } from '@/i18n/navigation';
import type { Plate } from '@/lib/plate/types';

export interface FoundResult {
  postId: string;
  kind: 'exact' | 'near';
  plate: Plate;
  formatStatus: 'valid' | 'unverified';
  createdAt: string;
  cropUrl: string | null;
}

/**
 * Found plates matching a search: photo, plate, match strength, how long ago, and the
 * contact-reveal checkpoint right on the card (people who found their plate act immediately).
 */
export function FoundResults({
  results,
  ownIds,
}: {
  results: FoundResult[];
  /** The user's own found posts: marked, and no offer to contact themselves (D-091). */
  ownIds?: Set<string>;
}) {
  const tOwn = useTranslations('own');
  const t = useTranslations('search');
  const tp = useTranslations('plate');
  const format = useFormatter();
  const now = new Date();

  return (
    <ul className="space-y-3">
      {results.map((r) => (
        <li key={r.postId} className="rounded-md border-2 border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-sm px-2 py-0.5 text-sm font-bold ${
                r.kind === 'exact' ? 'bg-accent text-on-accent' : 'border-2 border-line text-ink'
              }`}
            >
              {r.kind === 'exact' ? t('exact') : t('near')}
            </span>
            {r.formatStatus === 'unverified' && (
              <span className="rounded-sm border-2 border-dashed border-line-soft px-2 py-0.5 text-sm">
                {tp('unverified')}
              </span>
            )}
            {ownIds?.has(r.postId) && (
              <span className="rounded-sm border-2 border-line px-2 py-0.5 text-sm font-bold">
                {tOwn('yourPost')}
              </span>
            )}
            <span className="ms-auto text-sm text-ink-muted">
              {t('posted', { when: format.relativeTime(new Date(r.createdAt), now) })}
            </span>
          </div>
          {r.kind === 'near' && <p className="mt-1 text-sm text-ink-muted">{t('nearHint')}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {r.cropUrl && (
              // Plain <img>: signed URLs to private crops must not go through the image optimizer cache.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.cropUrl}
                alt={t('cropAlt')}
                loading="lazy"
                decoding="async"
                className="max-h-36 w-full max-w-xs rounded-sm border-2 border-line-soft object-contain"
              />
            )}
            <PlateView plate={r.plate} size="sm" />
          </div>
          <div className="mt-3 space-y-2">
            {ownIds?.has(r.postId) ? (
              <Link href="/my-posts" className={`${textLink} inline-flex min-h-11 items-center`}>
                {tOwn('manageYours')}
              </Link>
            ) : (
              <RevealContact postId={r.postId} />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/post/${r.postId}`}
                className={`${textLink} inline-flex min-h-11 items-center`}
              >
                {t('viewPost')}
              </Link>
              {!ownIds?.has(r.postId) && <ReportButton postId={r.postId} />}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
