'use client';

import { useTranslations } from 'next-intl';
import { Field, TextArea } from '@/components/ui/Field';

const MAX = 300;

/** Optional หมายเหตุ box for either side; says who will see it and what isn't allowed. */
export function NoteField({
  kind,
  value,
  onChange,
  error,
}: {
  kind: 'lost' | 'found';
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  const t = useTranslations('note');
  const tc = useTranslations('common');
  return (
    <Field
      label={t('label')}
      optional={tc('optional')}
      error={error}
      hint={
        <>
          {t(kind === 'lost' ? 'lostHint' : 'foundHint')}
          <br />
          {t(kind === 'lost' ? 'lostShownTo' : 'foundShownTo')} {t('rule')}
        </>
      }
    >
      {({ inputId, describedBy, invalid }) => (
        <>
          <TextArea
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value}
            maxLength={MAX}
            onChange={(e) => onChange(e.target.value)}
          />
          <p className="text-end text-sm text-ink-muted" aria-hidden="true">
            {[...value].length}/{MAX}
          </p>
        </>
      )}
    </Field>
  );
}
