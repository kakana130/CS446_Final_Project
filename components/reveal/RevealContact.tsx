'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Turnstile, type TurnstileHandle } from '@/components/forms/Turnstile';
import { useErrorText } from '@/components/forms/useErrorText';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { postJson } from '@/lib/client/api';
import { ContactCard } from './ContactCard';

interface Contact {
  lineId: string | null;
  phone: string | null;
  email: string | null;
  handover: 'with_finder' | 'police_station' | null;
  policeStationNote: string | null;
  district: string | null;
  note: string | null;
}

/**
 * The anti-scam checkpoint (spec §3.5): the safety advice must be acknowledged and Turnstile
 * passed before the finder's contact is fetched. Every reveal is logged server-side.
 */
export function RevealContact({ postId }: { postId: string }) {
  const t = useTranslations('reveal');
  const tc = useTranslations('common');
  const tn = useTranslations('note');
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  async function reveal() {
    setError(null);
    if (!ack) {
      setError(errorText('consent_required'));
      return;
    }
    if (!token) {
      setError(errorText('turnstile_required'));
      return;
    }
    setBusy(true);
    const res = await postJson<{ contact: Contact }>(
      '/api/reveal',
      { postId, acknowledged: true, turnstileToken: token },
      0,
    );
    setBusy(false);
    turnstile.current?.reset();
    if (!res.ok) {
      setError(errorText(res.code));
      return;
    }
    setContact(res.data.contact);
    setOpen(false);
  }

  if (contact) {
    return (
      <ContactCard
        title={t('contactTitle')}
        reminder={t('reminder')}
        lineId={contact.lineId}
        phone={contact.phone}
        email={contact.email}
      >
        {contact.district && (
          <p>
            <span className="font-semibold">{t('district')}</span> {contact.district}
          </p>
        )}
        {contact.note && (
          <div>
            <p className="font-semibold">{tn('finderNote')}</p>
            <p className="whitespace-pre-line">{contact.note}</p>
          </div>
        )}
        {contact.handover && (
          <p>
            {contact.handover === 'police_station'
              ? t('atPolice', { station: contact.policeStationNote ?? '' })
              : t('withFinder')}
          </p>
        )}
      </ContactCard>
    );
  }

  return (
    <>
      <Button block onClick={() => setOpen(true)}>
        {t('button')}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('sheetTitle')}
        closeLabel={tc('close')}
      >
        <div className="space-y-4">
          <p>{t('intro')}</p>
          <ol className="list-decimal space-y-2 ps-6">
            <li className="font-semibold">{t('tip1')}</li>
            <li>{t('tip2')}</li>
            <li>{t('tip3')}</li>
            <li>{t('tip4')}</li>
          </ol>
          <Checkbox label={t('acknowledge')} checked={ack} onChange={setAck} />
          {open && <Turnstile ref={turnstile} action="reveal" onToken={setToken} />}
          {error && <Alert tone="error" title={error} live />}
          <Button block busy={busy} busyLabel={tc('sending')} onClick={reveal}>
            {t('confirm')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
