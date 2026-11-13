import { afterEach, describe, expect, it, vi } from 'vitest';
import { uid } from './uid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the page is secure', () => {
    expect(uid()).toMatch(V4);
  });

  it('still makes v4 UUIDs on plain http, where randomUUID is missing', () => {
    const real = globalThis.crypto;
    // What a browser exposes on an http page: getRandomValues, but no randomUUID.
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const ids = new Set(Array.from({ length: 200 }, uid));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });
});
