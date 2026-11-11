'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { PlateView } from '@/components/plate/PlateView';
import { ManyFindersAlert, ManyOwnersAlert } from '@/components/reveal/ManyClaims';
import { Button, buttonClass } from '@/components/ui/Button';
import { Link } from '@/i18n/navigation';
import type { OwnPost } from '@/lib/client/own-posts';

export type { OwnPost };

export type PostAction = 'resolve' | 'extend' | 'delete';

const DAY = 24 * 60 * 60 * 1000;
/** Posts can be extended up to 90 days after posting (manage_post in Postgres). */
const MAX_AGE_DAYS = 90;

/**
 * One of the user's own posts: what it is, its matches, and what they can do with it (D-078):
 * mark the plate as back with its owner, add 30 days, or delete (asks first).
 */
export function PostCard({
  post,
  busy,
  onAction,
}: {
  post: OwnPost;
  busy: boolean;
  onAction: (action: PostAction) => void;
}) {
  const t = useTranslations('myPosts');
  const format = useFormatter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = new Date();
  const open = post.status === 'active' || post.status === 'needs_review';
  const canExtend =
    open && Date.parse(post.expiresAt) < Date.parse(post.createdAt) + (MAX_AGE_DAYS - 1) * DAY;

  return (
    <li className="space-y-3 rounded-md border-2 border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-sm px-2 py-0.5 text-sm font-bold ${
            post.kind === 'lost' ? 'bg-accent text-on-accent' : 'border-2 border-line'
          }`}
        >
          {post.kind === 'lost' ? t('lost') : t('found')}
        </span>
        {post.status === 'resolved' && (
          <span className="rounded-sm border-2 border-success px-2 py-0.5 text-sm font-bold text-success">
            {post.kind === 'lost' ? t('resolvedLost') : t('resolvedFound')}
          </span>
        )}
      </div>
      <PlateView plate={post.plate} size="sm" />
      <p className="text-sm text-ink-muted">
        {t('posted', { when: format.relativeTime(new Date(post.createdAt), now) })}
        {open && (
          <>
            {' · '}
            {t('expires', { when: format.relativeTime(new Date(post.expiresAt), now) })}
          </>
        )}
      </p>
      {post.status === 'needs_review' && <p className="text-sm">{t('needsReview')}</p>}
      {post.status === 'hidden' && <p className="text-sm text-danger">{t('hidden')}</p>}

      {open &&
        (post.matches.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('noMatches')}</p>
        ) : (
          <div className="space-y-2">
            <p className="font-semibold">{t('matches', { count: post.matches.length })}</p>
            {/* Several on one plate: claimants for a found plate, front/rear for a lost one. */}
            {post.kind === 'found' ? (
              <ManyOwnersAlert count={post.matches.length} />
            ) : (
              <ManyFindersAlert count={post.matches.length} />
            )}
            {post.matches.map((m, i) => (
              <Link
                key={m.matchId}
                href={`/match/${m.matchId}`}
                className={buttonClass('primary', true)}
              >
                {post.matches.length > 1 ? t('viewMatchN', { n: i + 1 }) : t('viewMatch')}
              </Link>
            ))}
          </div>
        ))}

      <div className="flex flex-wrap gap-2 border-t-2 border-line-soft pt-3">
        {open && (
          <Button variant="secondary" disabled={busy} onClick={() => onAction('resolve')}>
            {post.kind === 'lost' ? t('resolveLost') : t('resolveFound')}
          </Button>
        )}
        {canExtend && (
          <Button variant="secondary" disabled={busy} onClick={() => onAction('extend')}>
            {t('extend')}
          </Button>
        )}
        {!confirmDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
            className="min-h-11 px-2 font-semibold text-danger underline decoration-2 underline-offset-4"
          >
            {t('delete')}
          </button>
        )}
      </div>
      {confirmDelete && (
        <div role="alert" className="space-y-2 rounded-md border-2 border-danger p-3">
          <p className="font-semibold">{t('deleteConfirm')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                setConfirmDelete(false);
                onAction('delete');
              }}
            >
              {t('deleteYes')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
