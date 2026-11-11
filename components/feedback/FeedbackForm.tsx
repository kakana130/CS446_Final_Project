'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { useErrorText } from '@/components/forms/useErrorText';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field, TextArea } from '@/components/ui/Field';
import { postJson } from '@/lib/client/api';

/** Feedback (D-080): 1–5 stars and an optional comment, read by the admin. */
export function FeedbackForm() {
  const t = useTranslations('feedback');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const locale = useLocale() as 'th' | 'en';
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    setError(null);
    if (rating === 0) {
      setError(t('pickRating'));
      return;
    }
    if (!token) {
      setError(errorText('turnstile_required'));
      return;
    }
    setBusy(true);
    const res = await postJson(
      '/api/feedback',
      { rating, comment, context: 'general', locale, turnstileToken: token },
      0,
    );
    setBusy(false);
    turnstile.current?.reset();
    setToken(null);
    if (!res.ok) {
      setError(errorText(res.fields.comment ?? res.code));
      return;
    }
    setDone(true);
  }

  if (done) return <Alert tone="success" title={t('thanks')} live />;

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 font-semibold">{t('ratingLegend')}</legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="inline-flex size-12 cursor-pointer items-center justify-center rounded-md border-2 border-line-soft bg-surface text-xl font-bold has-[:checked]:border-line has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-focus"
            >
              <input
                type="radio"
                name="feedback-rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                className="sr-only"
                aria-label={t('stars', { count: n })}
              />
              {n}
            </label>
          ))}
        </div>
        <p className="mt-1 text-sm text-ink-muted">{t('ratingHint')}</p>
      </fieldset>
      <Field label={t('commentLabel')} optional={tc('optional')}>
        {({ inputId, describedBy }) => (
          <TextArea
            id={inputId}
            aria-describedby={describedBy}
            value={comment}
            maxLength={500}
            rows={4}
            onChange={(e) => setComment(e.target.value)}
          />
        )}
      </Field>
      <Turnstile ref={turnstile} action="feedback" onToken={setToken} />
      {error && <Alert tone="error" title={error} live />}
      <Button busy={busy} busyLabel={tc('sending')} onClick={send}>
        {t('send')}
      </Button>
    </div>
  );
}
