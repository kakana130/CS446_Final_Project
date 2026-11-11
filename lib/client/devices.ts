/**
 * Device tokens: on post creation the server returns a random secret (it stores only the
 * hash). Keeping it in localStorage lets "My posts" manage posts from this device without
 * signing in (D-085). Storage can be missing (private mode), so everything is best effort.
 */

const KEY = 'p2h.devices';

export interface DevicePost {
  batchId: string;
  kind: 'lost' | 'found';
  token: string;
  /** Plate display text(s) for the "My posts" list. Never contact details. */
  labels: string[];
  createdAt: string;
  /** Sent while signed in, so the batch belongs to an account now (D-094). */
  linked?: boolean;
}

export function readDevicePosts(): DevicePost[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as DevicePost[]) : [];
  } catch {
    return [];
  }
}

export function rememberDevicePost(post: DevicePost): void {
  try {
    const others = readDevicePosts().filter((p) => p.batchId !== post.batchId);
    localStorage.setItem(KEY, JSON.stringify([post, ...others].slice(0, 50)));
  } catch {
    // Without storage the user can still manage the post by signing in with Google.
  }
}

/** The batch was deleted: stop listing it under "My posts". */
export function forgetDevicePost(batchId: string): void {
  try {
    const rest = readDevicePosts().filter((p) => p.batchId !== batchId);
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    // Nothing stored, nothing to forget.
  }
}

/** Posts on this device not yet linked to an account (e.g. made while signed out). */
export function unlinkedDevicePosts(): DevicePost[] {
  return readDevicePosts().filter((p) => !p.linked);
}

/** These batches were sent while signed in: each has an owner now, so stop sending them. */
export function markDevicePostsLinked(batchIds: string[]): void {
  try {
    const done = new Set(batchIds);
    const posts = readDevicePosts().map((p) => (done.has(p.batchId) ? { ...p, linked: true } : p));
    localStorage.setItem(KEY, JSON.stringify(posts));
  } catch {
    // Without storage they are sent again next time; linking is idempotent.
  }
}
