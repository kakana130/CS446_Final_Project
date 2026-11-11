import { getTranslations } from 'next-intl/server';
import { textLink } from '@/components/ui/styles';
import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-2 text-ink-muted">{t('body')}</p>
      <p className="mt-6">
        <Link href="/" className={`${textLink} inline-flex min-h-11 items-center`}>
          {t('home')}
        </Link>
      </p>
    </div>
  );
}
