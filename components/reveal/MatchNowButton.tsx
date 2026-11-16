'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useErrorText } from '@/components/forms/useErrorText';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { postJson } from '@/lib/client/api';

const COOLDOWN_SECONDS = 5;

/**
 * "Match Now!": Amazon SNS emails both sides of this match again (owner and finder, each with
 * the other's contact), e.g. after one of them confirmed their email. The button rests for 5
 * seconds after each press; the server enforces the same per match.
 */
export function MatchNowButton({ matchId }: { matchId: string }) {
  const t = useTranslations('match');
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [result, setResult] = useState<{ tone: 'success' | 'info' | 'error'; text: string } | null>(
    null,
  );

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function press() {
    setBusy(true);
    setResult(null);
    const res = await postJson<{ recipients: number }>('/api/match-notify', { matchId }, 0);
    setBusy(false);
    setWait(COOLDOWN_SECONDS);
    if (!res.ok) {
      setResult({ tone: 'error', text: errorText(res.code) ?? '' });
    } else if (res.data.recipients > 0) {
      setResult({ tone: 'success', text: t('matchNowSent', { count: res.data.recipients }) });
    } else {
      setResult({ tone: 'info', text: t('matchNowNone') });
    }
  }

  return (
    <section className="space-y-2 rounded-md border-2 border-line bg-surface p-4">
      <Button block busy={busy} disabled={wait > 0} onClick={press}>
        {wait > 0 ? t('matchNowWait', { seconds: wait }) : t('matchNow')}
      </Button>
      <p className="text-sm text-ink-muted">{t('matchNowHint')}</p>
      {result && <Alert tone={result.tone} title={result.text} live />}
    </section>
  );
}
