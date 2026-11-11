'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useErrorText } from '@/components/forms/useErrorText';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Link } from '@/i18n/navigation';
import { postJson } from '@/lib/client/api';
import { readDevicePosts } from '@/lib/client/devices';
import { useSession } from '@/lib/client/session';
import { ContactCard } from './ContactCard';
import { ManyFindersAlert, ManyOwnersAlert } from './ManyClaims';
import { RevealContact } from './RevealContact';

interface OwnerContact {
  lineId: string | null;
  phone: string | null;
  email: string | null;
}

const noSubscribe = () => () => {};

/**
 * Contact on the match page depends on who is looking: this device knows from the device
 * tokens stored when posting, and a signed-in account asks the server (D-085):
 *  - the finder (found batch token or account) sees the owner's contact (D-002);
 *  - everyone else (normally the owner) goes through the finder-contact reveal.
 */
export function MatchContact({
  matchId,
  foundPostId,
  foundBatchId,
  lostBatchId,
  owners,
  finders,
}: {
  matchId: string;
  foundPostId: string;
  foundBatchId: string;
  lostBatchId: string;
  /** Active lost reports on this found plate, and found posts on this lost plate (D-104). */
  owners: number;
  finders: number;
}) {
  const t = useTranslations('match');
  const tc = useTranslations('common');
  const tMine = useTranslations('myPosts');
  const errorText = useErrorText();
  // Read on the client only; the server render shows the default (owner) view.
  const finderToken = useSyncExternalStore(
    noSubscribe,
    () => readDevicePosts().find((d) => d.batchId === foundBatchId)?.token ?? null,
    () => null,
  );
  const isOwner = useSyncExternalStore(
    noSubscribe,
    () => readDevicePosts().some((d) => d.batchId === lostBatchId),
    () => false,
  );
  const session = useSession();
  const signedIn = session.status === 'signed-in';
  const [roles, setRoles] = useState({ finder: false, owner: false });
  useEffect(() => {
    if (!signedIn || finderToken) return;
    let cancelled = false;
    void postJson<{ finder: boolean; owner: boolean }>('/api/match-role', { matchId }).then(
      (res) => {
        if (!cancelled && res.ok) setRoles(res.data);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn, finderToken, matchId]);
  const isFinder = finderToken !== null || (signedIn && roles.finder);
  const [contact, setContact] = useState<OwnerContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both posts are this person's (testing, or a plate they found themselves): there is nobody
  // to contact (D-091).
  if (isFinder && (isOwner || (signedIn && roles.owner))) {
    return (
      <Alert tone="info" title={t('bothYoursTitle')}>
        <p>{t('bothYoursBody')}</p>
        <Link href="/my-posts" className={`${buttonClass('primary')} mt-3`}>
          {tMine('title')}
        </Link>
      </Alert>
    );
  }

  if (isFinder) {
    if (contact) {
      return (
        <div className="space-y-3">
          <ManyOwnersAlert count={owners} />
          <ContactCard
            title={t('ownerContactTitle')}
            reminder={t('finderReminder')}
            lineId={contact.lineId}
            phone={contact.phone}
            email={contact.email}
          />
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <ManyOwnersAlert count={owners} />
        <Alert tone="highlight" title={t('youAreFinder')}>
          <p>{t('finderBody')}</p>
        </Alert>
        {error && <Alert tone="error" title={error} live />}
        <Button
          block
          busy={busy}
          busyLabel={tc('sending')}
          onClick={async () => {
            setError(null);
            setBusy(true);
            const res = await postJson<{ contact: OwnerContact }>(
              '/api/reveal-owner',
              { matchId, token: finderToken ?? undefined },
              0,
            );
            setBusy(false);
            if (res.ok) setContact(res.data.contact);
            else setError(errorText(res.code));
          }}
        >
          {t('ownerContactButton')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(isOwner || (signedIn && roles.owner)) && (
        <p className="font-semibold">{t('youAreOwner')}</p>
      )}
      <ManyFindersAlert count={finders} />
      <RevealContact postId={foundPostId} />
    </div>
  );
}
