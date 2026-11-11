import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from './csp';

const parse = (csp: string) =>
  Object.fromEntries(
    csp.split('; ').map((d) => {
      const [name, ...values] = d.split(' ');
      return [name, values];
    }),
  );

describe('buildCsp (production)', () => {
  const csp = parse(
    buildCsp({
      nonce: 'abc123',
      isDev: false,
      storageOrigin: 'https://crops.s3.us-east-1.amazonaws.com/some/path',
    }),
  );

  it('requires the nonce for scripts and never allows unsafe-inline/eval scripts', () => {
    expect(csp['script-src']).toContain("'nonce-abc123'");
    expect(csp['script-src']).toContain("'strict-dynamic'");
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
  });

  it('allows WebAssembly compilation for the in-browser OCR', () => {
    expect(csp['script-src']).toContain("'wasm-unsafe-eval'");
  });

  it('forbids framing and plugins', () => {
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
  });

  it('allows only Turnstile for network access', () => {
    expect(csp['connect-src']).toEqual(["'self'", 'https://challenges.cloudflare.com']);
    expect(csp['frame-src']).toEqual(['https://challenges.cloudflare.com']);
  });

  it('allows images from the S3 bucket origin (not path)', () => {
    expect(csp['img-src']).toContain('https://crops.s3.us-east-1.amazonaws.com');
  });

  it('upgrades insecure requests', () => {
    expect(csp).toHaveProperty('upgrade-insecure-requests');
  });

  it('does not upgrade a page served over plain http (production build on localhost)', () => {
    expect(parse(buildCsp({ nonce: 'n', isDev: false, secure: false }))).not.toHaveProperty(
      'upgrade-insecure-requests',
    );
  });

  it('uses the nonce for style elements in production', () => {
    expect(csp['style-src-elem']).toContain("'nonce-abc123'");
    expect(csp['style-src-elem']).not.toContain("'unsafe-inline'");
  });
});

describe('buildCsp (development)', () => {
  const csp = parse(buildCsp({ nonce: 'n', isDev: true }));

  it('permits eval for React dev tooling and skips the https upgrade on localhost', () => {
    expect(csp['script-src']).toContain("'unsafe-eval'");
    expect(csp).not.toHaveProperty('upgrade-insecure-requests');
  });

  it('omits the Supabase origin when not configured', () => {
    expect(csp['connect-src']).toEqual(["'self'", 'https://challenges.cloudflare.com']);
  });
});

describe('createNonce', () => {
  it('returns distinct base64 values of 16 bytes', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });
});
