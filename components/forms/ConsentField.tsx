'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/Field';
import { Link } from '@/i18n/navigation';
import { POST_MAX_DAYS, POST_TTL_DAYS } from '@/lib/config/app';

/**
 * The consent checkbox before posting (its wording is versioned by CONSENT_VERSION, D-090),
 * with the Privacy Policy one tap away in a new tab so the form stays as it is.
 */
export function ConsentField({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | null;
}) {
  const t = useTranslations('consent');
  return (
    <Checkbox
      label={t('label', { days: POST_TTL_DAYS, maxDays: POST_MAX_DAYS })}
      checked={checked}
      onChange={onChange}
      error={error}
    >
      <Link
        href="/privacy"
        target="_blank"
        rel="noopener"
        className="ms-1 font-semibold underline underline-offset-4"
      >
        {t('policyLink')}
      </Link>
    </Checkbox>
  );
}
