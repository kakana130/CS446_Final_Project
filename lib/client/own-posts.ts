'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { postJson } from '@/lib/client/api';
import { readDevicePosts } from '@/lib/client/devices';
import { useSession } from '@/lib/client/session';
import { normalizePlate } from '@/lib/plate/normalize';
import { samePlate } from '@/lib/plate/same';
import type { Plate, PlateInput } from '@/lib/plate/types';

/**
 * The user's own posts (this device's and, when signed in, the account's), so the flows can
 * recognise a plate the user posted themselves (D-091): no second lost report for the same
 * plate, no "someone is looking for it" when that someone is the user, and no offer to
 * contact yourself. Loaded once per page and person; best effort (nothing breaks without it).
 */

export interface OwnPost {
  batchId: string;
  postId: string;
  kind: 'lost' | 'found';
  plate: Plate;
  status: 'active' | 'needs_review' | 'hidden' | 'resolved';
  createdAt: string;
  expiresAt: string;
  matches: { matchId: string; kind: 'exact' | 'near'; createdAt: string }[];
}

export type OwnPosts = { status: 'loading' } | { status: 'ready'; posts: OwnPost[] };

let state: OwnPosts = { status: 'loading' };
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function set(next: OwnPosts) {
  state = next;
  for (const l of listeners) l();
}

async function load(key: string, devices: { batchId: string; token: string }[], signedIn: boolean) {
  if (devices.length === 0 && !signedIn) {
    set({ status: 'ready', posts: [] });
    return;
  }
  const res = await postJson<{ posts: OwnPost[] }>('/api/my-posts', { devices }, 1);
  // A newer load (other person, new post) wins over a slow older one.
  if (loadedFor !== key) return;
  set({ status: 'ready', posts: res.ok ? res.data.posts : [] });
}

export function useOwnPosts(): OwnPosts {
  const session = useSession();
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  const who = session.status === 'signed-in' ? `in:${session.email}` : session.status;

  useEffect(() => {
    if (who === 'loading') return;
    const devices = readDevicePosts().map((d) => ({ batchId: d.batchId, token: d.token }));
    // Reload when the person or this device's posts changed since the last load.
    const key = `${who}|${devices.map((d) => d.batchId).join(',')}`;
    if (loadedFor === key) return;
    loadedFor = key;
    set({ status: 'loading' });
    void load(key, devices, who.startsWith('in:'));
  }, [who]);

  return value;
}

/**
 * The user's posts once loaded, for a check made right after the page opened (the user can
 * be faster than the request). Gives up after `timeoutMs` and answers with what it has.
 */
export function ownPostsReady(timeoutMs = 4000): Promise<OwnPosts> {
  if (state.status === 'ready') return Promise.resolve(state);
  return new Promise((resolve) => {
    const finish = () => {
      listeners.delete(onChange);
      clearTimeout(timer);
      resolve(state);
    };
    const onChange = () => {
      if (state.status === 'ready') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    listeners.add(onChange);
  });
}

/** Posts still in play: a resolved post no longer stops the user from posting the plate. */
const LIVE: OwnPost['status'][] = ['active', 'needs_review', 'hidden'];

/** The user's live posts of this kind for this plate, newest first. */
export function ownPostsFor(own: OwnPosts, input: PlateInput, kind: OwnPost['kind']): OwnPost[] {
  if (own.status !== 'ready') return [];
  const plate = normalizePlate(input);
  return own.posts
    .filter((p) => p.kind === kind && LIVE.includes(p.status) && samePlate(p.plate, plate))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Post ids of the user's own found posts (to mark them in search results). */
export function ownFoundIds(own: OwnPosts): Set<string> {
  return new Set(
    own.status === 'ready' ? own.posts.filter((p) => p.kind === 'found').map((p) => p.postId) : [],
  );
}
