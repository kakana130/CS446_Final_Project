'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { Checkbox, Field, TextInput } from '@/components/ui/Field';
import { useSession } from '@/lib/client/session';
import type { ContactBody } from '@/lib/validation/schemas';

export type ContactDraft = Required<ContactBody>;
export const EMPTY_CONTACT: ContactDraft = { lineId: '', phone: '', email: '', showEmail: false };

/**
 * LINE ID (recommended), phone and optional email, each validated next to the field. When
 * signed in with Google and nothing is entered yet, the account's email is filled in and
 * shown as the contact; the user can remove or change it (D-085).
 */
export function ContactFields({
  value,
  onChange,
  errors,
  shownTo,
}: {
  /** Who will see these details once matched: the owner (found flow) or the finder. */
  shownTo: 'owner' | 'finder';
  value: ContactDraft;
  onChange: (value: ContactDraft) => void;
  errors: Record<string, string | null>;
}) {
  const t = useTranslations('contact');
  const tc = useTranslations('common');
  const tAccount = useTranslations('account');
  const set = (patch: Partial<ContactDraft>) => onChange({ ...value, ...patch });

  const session = useSession();
  const accountEmail = session.status === 'signed-in' ? session.email : null;
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!accountEmail || filledFor.current === accountEmail) return;
    filledFor.current = accountEmail;
    const { value: v, onChange: change } = latest.current;
    if (!v.lineId.trim() && !v.phone.trim() && !v.email.trim()) {
      change({ ...v, email: accountEmail, showEmail: true });
    }
  }, [accountEmail]);

  return (
    <fieldset className="space-y-4">
      <legend className="text-lg font-bold">{t('title')}</legend>
      <p className="text-ink-muted">{t(shownTo === 'finder' ? 'introLost' : 'introFound')}</p>
      {errors.contact && (
        <p role="alert" className="font-semibold text-danger">
          {errors.contact}
        </p>
      )}
      <Field label={t('lineId')} hint={t('lineIdHint')} error={errors.lineId}>
        {({ inputId, describedBy, invalid }) => (
          <TextInput
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value.lineId}
            onChange={(e) => set({ lineId: e.target.value })}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
      </Field>
      <Field label={t('phone')} optional={tc('optional')} error={errors.phone}>
        {({ inputId, describedBy, invalid }) => (
          <TextInput
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value.phone}
            onChange={(e) => set({ phone: e.target.value })}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
          />
        )}
      </Field>
      <Field
        label={t('email')}
        optional={tc('optional')}
        hint={
          accountEmail && value.email === accountEmail ? tAccount('emailFromAccount') : undefined
        }
        error={errors.email}
      >
        {({ inputId, describedBy, invalid }) => (
          <TextInput
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            value={value.email}
            onChange={(e) => set({ email: e.target.value })}
            type="email"
            inputMode="email"
            autoComplete="email"
          />
        )}
      </Field>
      {value.email.trim() && (
        <Checkbox
          label={t('showEmail')}
          checked={value.showEmail}
          onChange={(showEmail) => set({ showEmail })}
        />
      )}
    </fieldset>
  );
}
