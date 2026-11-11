'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Spinner } from '@/components/ui/Button';
import { postJson } from '@/lib/client/api';
import { draftToInput, type PlateDraft } from '@/lib/plate/draft';
import { plateInputSchema } from '@/lib/validation/schemas';

type Match = 'exact' | 'near' | null;

const DEBOUNCE_MS = 600;

/**
 * Found flow, step 1: as soon as a plate card holds a complete plate, tell the finder whether
 * someone is looking for it (D-064). Only yes/near/no comes back; the match itself is recorded
 * when the plate is posted.
 */
export function LostWatchHint({ draft }: { draft: PlateDraft }) {
  const t = useTranslations('found.lostCheck');
  // The answer for the plate it was asked about; anything else means "still checking".
  const [answer, setAnswer] = useState<{ key: string; match: Match | 'failed' } | null>(null);

  const parsed = plateInputSchema.safeParse(draftToInput(draft));
  const key = parsed.success ? JSON.stringify(parsed.data) : null;

  useEffect(() => {
    if (!key) return;
    let live = true;
    const timer = setTimeout(async () => {
      const res = await postJson<{ match: Match }>(
        '/api/lost-check',
        { plate: JSON.parse(key) },
        1,
      );
      // A failed check is not worth an error: posting still matches as usual.
      if (live) setAnswer({ key, match: res.ok ? res.data.match : 'failed' });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  if (!key) return null;
  if (answer?.key !== key) {
    return (
      <p className="inline-flex items-center gap-2 text-sm" aria-live="polite">
        <Spinner /> {t('checking')}
      </p>
    );
  }
  if (answer.match === 'failed') return null;
  if (answer.match === 'exact') {
    return (
      <Alert tone="highlight" title={t('exactTitle')} live>
        <p>{t('exactBody')}</p>
      </Alert>
    );
  }
  if (answer.match === 'near') {
    return (
      <Alert tone="highlight" title={t('nearTitle')} live>
        <p>{t('nearBody')}</p>
      </Alert>
    );
  }
  return (
    <p className="text-sm text-ink-muted" aria-live="polite">
      {t('none')}
    </p>
  );
}
