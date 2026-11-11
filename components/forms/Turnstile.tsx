'use client';

import { useLocale, useTranslations } from 'next-intl';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { TurnstileAction } from '@/lib/security/turnstile-actions';

interface TurnstileApi {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'light' | 'dark';
      language: string;
      size: 'flexible';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | undefined;

/**
 * Inserted by our own (nonce'd) code, so CSP 'strict-dynamic' allows it without adding the
 * script to every page. Loaded only on pages that post data.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile'));
    s.onerror = () => {
      loading = undefined;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface TurnstileHandle {
  /** Tokens are single-use: reset after every submission attempt. */
  reset(): void;
}

export const Turnstile = forwardRef<
  TurnstileHandle,
  { action: TurnstileAction; onToken: (token: string | null) => void }
>(function Turnstile({ action, onToken }, ref) {
  const t = useTranslations('turnstile');
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          language: locale,
          size: 'flexible',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action, locale]);

  if (!siteKey) {
    return <p className="text-sm text-danger">{t('missingKey')}</p>;
  }
  return <div ref={container} className="min-h-16" />;
});
