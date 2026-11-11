/**
 * Content-Security-Policy for HTML responses. Built per request in proxy.ts with a fresh nonce.
 * Every origin allowed here must be justified in docs/security-checklist.md.
 */

const TURNSTILE = 'https://challenges.cloudflare.com';

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** The S3 bucket origin that serves presigned plate-crop URLs (images only). */
  storageOrigin?: string;
  /**
   * The page was served over https (default). Over plain http (a production build on
   * localhost, as in CI) upgrading would point every asset at an https server that isn't there.
   */
  secure?: boolean;
}

export function buildCsp({ nonce, isDev, storageOrigin, secure = true }: CspOptions): string {
  const storage = storageOrigin ? new URL(storageOrigin).origin : undefined;
  const n = `'nonce-${nonce}'`;

  // A directive set to `undefined` is omitted entirely; `undefined` values inside are dropped.
  const directives: Record<string, (string | undefined)[] | undefined> = {
    'default-src': ["'self'"],
    // 'strict-dynamic' lets nonce'd scripts load their chunks; host entries are CSP2 fallbacks.
    // 'wasm-unsafe-eval' is required by onnxruntime-web / tesseract.js in the found flow.
    'script-src': [
      "'self'",
      n,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      TURNSTILE,
      isDev ? "'unsafe-eval'" : undefined,
    ],
    'style-src': ["'self'", isDev ? "'unsafe-inline'" : n],
    'style-src-elem': ["'self'", isDev ? "'unsafe-inline'" : n],
    // Style attributes cannot execute script; allowing them keeps third-party widgets working.
    'style-src-attr': ["'unsafe-inline'"],
    // Plate crops (presigned S3 URLs) and the signed-in user's Google picture (D-102).
    'img-src': ["'self'", 'blob:', 'data:', storage, 'https://lh3.googleusercontent.com'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", TURNSTILE],
    'frame-src': [TURNSTILE],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': isDev || !secure ? undefined : [],
  };

  return Object.entries(directives)
    .flatMap(([name, values]) => (values ? [[name, ...values.filter(Boolean)].join(' ')] : []))
    .join('; ');
}

/** 128 bits of randomness, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
