'use client';

import { useTranslations } from 'next-intl';
import { AccountBadge } from '@/components/auth/AccountBadge';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { buttonClass } from '@/components/ui/Button';
import { inAppBrowser, lineExternalUrl } from '@/lib/client/inapp';
import { signOut, useSession } from '@/lib/client/session';

/**
 * Optional Google sign-in (D-085): what it gives (managing posts from any device), the
 * button, and once signed in, who you are and how to sign out. Never required to post.
 * Inside LINE, Facebook and the like, where Google refuses to sign in, it points to the
 * phone's browser instead (D-086).
 */
export function AccountBox({ context }: { context: 'post' | 'manage' }) {
  const t = useTranslations('account');
  const session = useSession();

  if (session.status === 'loading') return null;

  if (session.status === 'signed-in') {
    return (
      <div className="space-y-1 rounded-md border-2 border-line-soft bg-surface p-3">
        <p className="flex max-w-full items-center gap-2">
          <span className="shrink-0">{t('signedInAs')}</span>
          <AccountBadge email={session.email} avatarUrl={session.avatarUrl} />
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline decoration-2 underline-offset-4"
        >
          {t('signOut')}
        </button>
      </div>
    );
  }

  // Rendered only after the session check, so reading the browser here never hydrates.
  const inApp = inAppBrowser(navigator.userAgent);

  // Highlighted like the contact card, so it stands out from the form around it (D-095).
  return (
    <div className="space-y-3 rounded-md border-2 border-line bg-accent-soft p-4">
      <p className="font-heading text-lg font-bold">{t('signInTitle')}</p>
      <p className="text-sm">{t(context === 'post' ? 'signInBody' : 'signInBodyManage')}</p>
      {inApp ? (
        <>
          <p className="text-sm">{t('inAppBody')}</p>
          {inApp === 'line' ? (
            <a
              href={lineExternalUrl(window.location.href)}
              className={buttonClass('secondary', true)}
            >
              {t('inAppOpen')}
            </a>
          ) : (
            <p className="text-sm font-semibold">{t('inAppMenu')}</p>
          )}
        </>
      ) : (
        <GoogleSignInButton />
      )}
      {context === 'post' && <p className="text-sm">{t('signInOptional')}</p>}
    </div>
  );
}
