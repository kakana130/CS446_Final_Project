'use client';

import { useTranslations } from 'next-intl';
import { headerControl } from '@/components/ui/styles';
import { applyTheme, readTheme } from './theme';

/**
 * Both labels are rendered and CSS picks the visible one from [data-theme], so the server
 * markup never depends on the (client-only) stored theme and there is no hydration mismatch.
 */
export function ThemeToggle() {
  const t = useTranslations('theme');

  return (
    <button
      type="button"
      onClick={() => applyTheme(readTheme() === 'dark' ? 'light' : 'dark')}
      className={headerControl}
    >
      {/* Visible short label; screen readers get the full phrase, which contains it (WCAG 2.5.3). */}
      <span className="dark:hidden">
        <span aria-hidden="true">{t('toDark')}</span>
        <span className="sr-only">{t('toDarkLabel')}</span>
      </span>
      <span className="hidden dark:inline">
        <span aria-hidden="true">{t('toLight')}</span>
        <span className="sr-only">{t('toLightLabel')}</span>
      </span>
    </button>
  );
}
