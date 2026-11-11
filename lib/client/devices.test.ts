import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  markDevicePostsLinked,
  readDevicePosts,
  rememberDevicePost,
  unlinkedDevicePosts,
  type DevicePost,
} from './devices';

function post(batchId: string): DevicePost {
  return { batchId, kind: 'lost', token: `t-${batchId}`, labels: [], createdAt: '2026-10-29' };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
});

describe('linking device posts to an account (D-094)', () => {
  it('sends only the posts not yet linked, including ones made after an earlier sign-in', () => {
    rememberDevicePost(post('a'));
    rememberDevicePost(post('b'));
    markDevicePostsLinked(['a', 'b']);
    expect(unlinkedDevicePosts()).toEqual([]);

    // Signed out again, then a new post on this device: only that one is still to link.
    rememberDevicePost(post('c'));
    expect(unlinkedDevicePosts().map((p) => p.batchId)).toEqual(['c']);
    expect(readDevicePosts().map((p) => p.batchId)).toEqual(['c', 'b', 'a']);
  });

  it('keeps the posts and their tokens when marking them linked', () => {
    rememberDevicePost(post('a'));
    markDevicePostsLinked(['a']);
    expect(readDevicePosts()).toEqual([{ ...post('a'), linked: true }]);
  });
});
