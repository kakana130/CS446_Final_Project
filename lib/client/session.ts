'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { postJson } from '@/lib/client/api';
import { markDevicePostsLinked, unlinkedDevicePosts } from '@/lib/client/devices';

/**
 * Optional Google sign-in on the client (D-085). The session itself is an httpOnly cookie;
 * this only asks the server who is signed in, and re-asks when a sign-in window finishes
 * (BroadcastChannel, with a storage event as fallback) or the tab comes back into view.
 */

export type Session =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; email: string | null; avatarUrl: string | null };

const CHANNEL = 'p2h-auth';
const STORAGE_KEY = 'p2h.auth';

let session: Session = { status: 'loading' };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: Session) {
  session = next;
  for (const l of listeners) l();
  if (next.status === 'signed-in') void linkDevicePosts();
}

let linking = false;

/**
 * Signed in: link the posts made on this device while signed out to the account (D-085,
 * D-094), whichever page the sign-in happened on, so they show on other devices without
 * opening "My posts" here first. "My posts" links them too; doing it twice is harmless.
 */
async function linkDevicePosts() {
  const pending = unlinkedDevicePosts();
  if (pending.length === 0 || linking) return;
  linking = true;
  const res = await postJson<{ signedIn: boolean }>(
    '/api/my-posts',
    { devices: pending.map((p) => ({ batchId: p.batchId, token: p.token })) },
    0,
  );
  linking = false;
  // Only a signed-in answer means the server linked them; otherwise try again next time.
  if (res.ok && res.data.signedIn) markDevicePostsLinked(pending.map((p) => p.batchId));
}

export function refreshSession(): Promise<void> {
  inflight ??= fetch('/api/auth/me', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .then((body: { user: { email: string | null; avatarUrl?: string | null } | null }) =>
      set(
        body.user
          ? { status: 'signed-in', email: body.user.email, avatarUrl: body.user.avatarUrl ?? null }
          : { status: 'signed-out' },
      ),
    )
    .catch(() => set({ status: 'signed-out' }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Tell other tabs (and the page that opened the sign-in window) that the session changed. */
export function announceSessionChange() {
  try {
    new BroadcastChannel(CHANNEL).postMessage('changed');
  } catch {
    // Older browsers: the storage event below still reaches other tabs.
  }
  try {
    localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // No storage: the opener re-checks when it is focused again.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): Session {
  const value = useSyncExternalStore(
    subscribe,
    () => session,
    () => session,
  );
  useEffect(() => {
    if (session.status === 'loading') void refreshSession();
    const onChange = () => void refreshSession();
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && onChange();
    const onVisible = () => document.visibilityState === 'visible' && onChange();
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = onChange;
    } catch {
      channel = null;
    }
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      channel?.close();
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return value;
}

/**
 * Open Google sign-in in a new window so this page keeps its photos and form. If pop-ups are
 * blocked, sign in in this tab and come back to this page.
 */
export function signIn(locale: string): boolean {
  const prefix = locale === 'th' ? '' : `/${locale}`;
  const next = `${prefix}/signed-in`;
  const popup = window.open(
    `/api/auth/login?next=${encodeURIComponent(next)}`,
    'p2h-signin',
    'popup,width=480,height=680',
  );
  if (popup) return true;
  // A route handler (full page navigation to Google), not a Next.js page.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/api/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
  return false;
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  set({ status: 'signed-out' });
  announceSessionChange();
}
