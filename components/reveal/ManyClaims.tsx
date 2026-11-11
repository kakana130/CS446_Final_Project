import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/Alert';

/**
 * For the finder, when more than one lost report matches the plate they found (D-104):
 * several people say it is theirs, so hand it over only against the registration book.
 */
export function ManyOwnersAlert({ count }: { count: number }) {
  const t = useTranslations('match');
  if (count < 2) return null;
  return (
    <Alert tone="error" title={t('manyOwnersTitle', { count })}>
      <p>{t('manyOwnersBody')}</p>
    </Alert>
  );
}

/**
 * For the owner, when more than one found post matches their plate (D-104): often the front
 * and rear plates, so they should look at every one rather than take it for a duplicate.
 */
export function ManyFindersAlert({ count }: { count: number }) {
  const t = useTranslations('match');
  if (count < 2) return null;
  return (
    <Alert tone="highlight" title={t('manyFindersTitle', { count })}>
      <p>{t('manyFindersBody')}</p>
    </Alert>
  );
}
