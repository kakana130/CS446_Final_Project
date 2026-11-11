'use client';

import { useLocale, useTranslations } from 'next-intl';
import { getPathname, usePathname } from '@/i18n/navigation';
import { LOCALE_COOKIE } from '@/i18n/routing';
import { headerControl } from '@/components/ui/styles';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * A plain <a>, not a client-side Link: changing locale swaps the root layout, and a full page
 * load keeps <html lang> and the pre-paint theme script correct without React re-rendering a
 * <script>. It also works without JS. On click the choice is stored in a cookie so unprefixed
 * URLs keep the chosen language on later visits (see proxy.ts).
 */
export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations('language');
  const other = locale === 'th' ? 'en' : 'th';

  const remember = () => {
    document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  };

  return (
    <a
      href={getPathname({ href: pathname, locale: other })}
      hrefLang={other}
      lang={other}
      onClick={remember}
      aria-label={t('switchToLabel')}
      className={headerControl}
    >
      {t('switchTo')}
    </a>
  );
}
