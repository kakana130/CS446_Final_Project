'use client';

import { useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui/Sheet';
import { buttonClass } from '@/components/ui/Button';
import { PLATE_CONSONANTS } from '@/lib/plate/chars';

/** On-screen Thai consonants for phones without a Thai keyboard installed. */
export function ConsonantSheet({
  open,
  onClose,
  onPick,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ch: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('plate');
  const tc = useTranslations('common');
  const key =
    'inline-flex size-12 items-center justify-center rounded-sm border-2 border-line-soft bg-surface text-xl hover:border-line';
  return (
    <Sheet open={open} onClose={onClose} title={t('lettersSheetTitle')} closeLabel={tc('close')}>
      <div className="grid grid-cols-6 gap-1.5" lang="th">
        {[...PLATE_CONSONANTS, '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '?'].map((c) => (
          <button key={c} type="button" className={key} onClick={() => onPick(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={buttonClass('secondary')} onClick={onDelete}>
          {t('lettersDelete')}
        </button>
        <button type="button" className={buttonClass('primary')} onClick={onClose}>
          {t('lettersDone')}
        </button>
      </div>
    </Sheet>
  );
}
