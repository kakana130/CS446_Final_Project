'use client';

import { useState } from 'react';

/**
 * The signed-in account at a glance (D-102): the Google profile picture (or the email's first
 * letter if there is none or it fails to load) and the email, cut short with "…" instead of
 * wrapping mid-address on narrow phones.
 */
export function AccountBadge({
  email,
  avatarUrl,
}: {
  email: string | null;
  avatarUrl: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const initial = (email ?? '?').charAt(0).toUpperCase();

  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2">
      {avatarUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny Google avatar, not worth the image optimiser
        <img
          src={avatarUrl}
          alt=""
          width={28}
          height={28}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-7 shrink-0 rounded-full border-2 border-line"
        />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-line bg-accent text-sm font-bold text-on-accent"
        >
          {initial}
        </span>
      )}
      {email && <span className="min-w-0 truncate font-semibold">{email}</span>}
    </span>
  );
}
