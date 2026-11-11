'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { apiErrorKey } from '@/lib/client/api';

/** Translate a field or API error code into a plain-language message (null for none). */
export function useErrorText() {
  const t = useTranslations('errors');
  return useCallback(
    (code: string | null | undefined): string | null => {
      if (!code) return null;
      if (t.has(code as never)) return t(code as never);
      return t(apiErrorKey(code) as never);
    },
    [t],
  );
}
