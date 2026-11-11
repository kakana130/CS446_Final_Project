'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { announceSessionChange } from '@/lib/client/session';

/** Tells the page that opened the sign-in window, then tries to close this window. */
export function SignedInNotice({ failed }: { failed: boolean }) {
  const t = useTranslations('account');
  useEffect(() => {
    announceSessionChange();
    if (!failed) window.close();
  }, [failed]);
  return (
    <div className="space-y-4">
      <p>{t(failed ? 'failedBody' : 'doneBody')}</p>
      <Button variant="secondary" onClick={() => window.close()}>
        {t('close')}
      </Button>
    </div>
  );
}
