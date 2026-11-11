'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { postJson } from '@/lib/client/api';

type PostAction = 'hide' | 'restore' | 'dismiss' | 'delete';

/** Buttons for one post in the admin lists; the page reloads its data after each action. */
export function AdminPostActions({
  postId,
  status,
  reported,
}: {
  postId: string;
  status: string;
  reported: boolean;
}) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(false);

  const run = async (action: PostAction) => {
    setBusy(true);
    setError(false);
    const res = await postJson('/api/admin/action', { action, postId }, 0);
    setBusy(false);
    if (!res.ok) setError(true);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === 'hidden' || status === 'needs_review' ? (
        <Button variant="secondary" disabled={busy} onClick={() => run('restore')}>
          {t('actions.restore')}
        </Button>
      ) : (
        status !== 'resolved' && (
          <Button variant="secondary" disabled={busy} onClick={() => run('hide')}>
            {t('actions.hide')}
          </Button>
        )
      )}
      {reported && (
        <Button variant="secondary" disabled={busy} onClick={() => run('dismiss')}>
          {t('actions.dismiss')}
        </Button>
      )}
      {confirm ? (
        <>
          <Button disabled={busy} onClick={() => run('delete')}>
            {t('actions.confirmDelete')}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            {t('actions.cancel')}
          </Button>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirm(true)}
          className="min-h-11 px-2 font-semibold text-danger underline decoration-2 underline-offset-4"
        >
          {t('actions.delete')}
        </button>
      )}
      {error && <span className="text-sm text-danger">{t('actionFailed')}</span>}
    </div>
  );
}

/** Open or pause the whole site. */
export function AdminModeToggle({ mode }: { mode: 'active' | 'dormant' }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const next = mode === 'active' ? 'dormant' : 'active';
  return (
    <Button
      variant={mode === 'active' ? 'secondary' : 'primary'}
      busy={busy}
      onClick={async () => {
        setBusy(true);
        await postJson('/api/admin/action', { action: 'mode', mode: next }, 0);
        setBusy(false);
        router.refresh();
      }}
    >
      {mode === 'active' ? t('pauseSite') : t('openSite')}
    </Button>
  );
}

export function AdminLogout() {
  const t = useTranslations('admin');
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await postJson('/api/admin/logout', {}, 0);
        router.replace('/admin/login');
        router.refresh();
      }}
      className="min-h-11 px-2 font-semibold underline decoration-2 underline-offset-4"
    >
      {t('logout')}
    </button>
  );
}
