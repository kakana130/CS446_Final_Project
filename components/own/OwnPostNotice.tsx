'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/Alert';
import { buttonClass } from '@/components/ui/Button';
import { Link } from '@/i18n/navigation';
import type { OwnPost } from '@/lib/client/own-posts';

/**
 * The plate the user is typing is one they posted themselves (D-091):
 *  - lostAgain:  reporting a plate lost that they already reported (no second report);
 *  - foundAgain: posting a found plate they already posted (fine if it is the other plate);
 *  - ownLost:    "finding" their own lost plate, or searching for it.
 */
export function OwnPostNotice({
  post,
  variant,
}: {
  post: OwnPost;
  variant: 'lostAgain' | 'foundAgain' | 'ownLost';
}) {
  const t = useTranslations('own');
  const tMine = useTranslations('myPosts');
  const format = useFormatter();
  const when = format.dateTime(new Date(post.createdAt), { dateStyle: 'medium' });

  return (
    <Alert tone={variant === 'foundAgain' ? 'info' : 'highlight'} title={t(`${variant}Title`)} live>
      <p>{t(`${variant}Body`, { when })}</p>
      {post.kind === 'lost' && post.matches.length > 0 && (
        <p className="mt-1 font-semibold">{t('matchesWaiting', { count: post.matches.length })}</p>
      )}
      <Link href="/my-posts" className={`${buttonClass('primary')} mt-3`}>
        {tMine('title')}
      </Link>
    </Alert>
  );
}
