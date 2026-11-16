'use client';

import { useTranslations } from 'next-intl';
import { EMPTY_CONTACT } from '@/components/forms/ContactFields';
import { LOST_DRAFT_KEY, writeDraft } from '@/components/forms/flow';
import { Button } from '@/components/ui/Button';
import { useRouter } from '@/i18n/navigation';
import { plateToDraft } from '@/lib/plate/draft';
import type { Plate } from '@/lib/plate/types';

/**
 * "Match Now! This plate is mine" on a found post: opens the lost-plate report at the contact
 * step with this plate filled in. Sending it records the match and emails both sides; the
 * finder's contact is then shown on the match page (there is no reveal outside a match).
 */
export function MatchNowFromPost({ plate }: { plate: Plate }) {
  const t = useTranslations('post');
  const router = useRouter();
  return (
    <section className="space-y-2 rounded-md border-2 border-line bg-surface p-4">
      <Button
        block
        onClick={() => {
          writeDraft(LOST_DRAFT_KEY, {
            plate: plateToDraft(plate),
            contact: EMPTY_CONTACT,
            note: '',
          });
          router.push('/lost?step=contact');
        }}
      >
        {t('matchNow')}
      </Button>
      <p className="text-sm text-ink-muted">{t('matchNowHint')}</p>
    </section>
  );
}
