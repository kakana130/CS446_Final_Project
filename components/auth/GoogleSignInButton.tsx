'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Spinner } from '@/components/ui/Button';
import { signIn } from '@/lib/client/session';

/**
 * Google's standard four-colour "G", unchanged as the branding rules require; the one place
 * raw colours are allowed, because they are Google's mark, not part of our palette.
 */
function GoogleLogo() {
  return (
    <svg width={24} height={24} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** The Google sign-in button (D-095), opening sign-in in a small window. */
export function GoogleSignInButton() {
  const t = useTranslations('account');
  const locale = useLocale();
  const [waiting, setWaiting] = useState(false);
  return (
    <>
      {/* Google's button pattern (light fill, outline, the "G" before the text), raised with
          our sign shadow so it reads as a real button. */}
      <button
        type="button"
        onClick={() => setWaiting(signIn(locale))}
        className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-md border-2 border-line bg-surface px-5 font-heading text-lg font-bold text-ink shadow-sign transition-[transform,box-shadow] duration-100 hover:bg-surface-sunk active:translate-y-0.5 active:shadow-sign-pressed"
      >
        <GoogleLogo />
        {t('signIn')}
      </button>
      {waiting && (
        <p className="inline-flex items-center gap-2 text-sm" aria-live="polite">
          <Spinner /> {t('waiting')}
        </p>
      )}
    </>
  );
}
