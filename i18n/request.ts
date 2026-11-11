import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';
import * as rootParams from 'next/root-params';
import { routing } from './routing';

export default getRequestConfig(async ({ locale: explicitLocale }) => {
  // Route handlers and server actions can't read root params; they pass the locale explicitly.
  let locale = explicitLocale;
  if (!locale) {
    const param = await rootParams.locale();
    // Routes outside [locale] (the admin area) have no locale param: Thai. A wrong one is a 404.
    if (param === undefined) locale = routing.defaultLocale;
    else if (!hasLocale(routing.locales, param)) notFound();
    else locale = param;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: 'Asia/Bangkok',
  };
});
