'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { useErrorText } from '@/components/forms/useErrorText';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Choice } from '@/components/ui/Choice';
import { Field, TextArea } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { postJson } from '@/lib/client/api';
import { REPORT_REASONS } from '@/lib/validation/schemas';

type Reason = (typeof REPORT_REASONS)[number];

/**
 * "Report" on a post (D-080): reason, optional note, Turnstile. Three different reporters
 * hide the post until an admin looks at it.
 */
export function ReportButton({ postId }: { postId: string }) {
  const t = useTranslations('report');
  const tc = useTranslations('common');
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>('scam');
  const [note, setNote] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    setError(null);
    if (!token) {
      setError(errorText('turnstile_required'));
      return;
    }
    setBusy(true);
    const res = await postJson('/api/report', { postId, reason, note, turnstileToken: token }, 0);
    setBusy(false);
    turnstile.current?.reset();
    setToken(null);
    if (!res.ok) {
      setError(errorText(res.fields.note ?? res.code));
      return;
    }
    setDone(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 px-1 text-sm font-semibold text-ink-muted underline decoration-2 underline-offset-4"
      >
        {t('button')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('title')} closeLabel={tc('close')}>
        {done ? (
          <div className="space-y-4">
            <Alert tone="success" title={t('thanks')} live>
              <p>{t('thanksBody')}</p>
            </Alert>
            <Button block variant="secondary" onClick={() => setOpen(false)}>
              {tc('close')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Choice<Reason>
              legend={t('reasonLegend')}
              value={reason}
              onChange={setReason}
              columns={1}
              options={REPORT_REASONS.map((r) => ({ value: r, label: t(`reasons.${r}`) }))}
            />
            <Field label={t('noteLabel')} optional={tc('optional')}>
              {({ inputId, describedBy }) => (
                <TextArea
                  id={inputId}
                  aria-describedby={describedBy}
                  value={note}
                  maxLength={300}
                  rows={3}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            {open && <Turnstile ref={turnstile} action="report" onToken={setToken} />}
            {error && <Alert tone="error" title={error} live />}
            <Button block busy={busy} busyLabel={tc('sending')} onClick={send}>
              {t('send')}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
