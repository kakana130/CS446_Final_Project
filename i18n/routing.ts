import { defineRouting } from 'next-intl/routing';

export const LOCALE_COOKIE = 'p2h_locale';

export const routing = defineRouting({
  locales: ['th', 'en'],
  defaultLocale: 'th',
  // Thai lives at `/`, English at `/en`.
  localePrefix: 'as-needed',
  // Many Thai phones run an English system UI; Accept-Language must not push them to /en.
  // An explicit choice is persisted in LOCALE_COOKIE and honoured by proxy.ts instead.
  localeDetection: false,
  localeCookie: false,
});

export type AppLocale = (typeof routing.locales)[number];
