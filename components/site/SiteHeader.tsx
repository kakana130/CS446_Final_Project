import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { brand } from '@/lib/config/brand';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { LanguageSwitcher } from './LanguageSwitcher';

export async function SiteHeader() {
  const locale = await getLocale();
  const t = await getTranslations('header');
  const name = brand.name[locale];

  return (
    <header className="border-b-2 border-line bg-surface">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-2">
        {/* The wordmark sits in a small plate frame: the plate is the product's visual anchor. */}
        <Link
          href="/"
          aria-label={t('homeLabel', { brand: name })}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-sm border-2 border-plate-edge bg-plate px-2 font-heading text-base font-bold text-plate-ink min-[400px]:text-lg"
        >
          {name}
        </Link>
        <div className="flex items-center gap-1.5">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
