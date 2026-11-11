/**
 * In-app browsers (LINE, Facebook, Instagram, TikTok, Android web views). Google refuses to
 * sign in inside them ("disallowed_useragent"), so sign-in sends people to their real
 * browser instead (D-086). LINE opens a link in the external browser when it carries
 * `openExternalBrowser=1`.
 */

export type InAppBrowser = 'line' | 'other';

export function inAppBrowser(userAgent: string): InAppBrowser | null {
  if (/\bLine\//i.test(userAgent)) return 'line';
  if (/FBAN|FBAV|FB_IAB|Instagram|BytedanceWebview|musical_ly|; wv\)/i.test(userAgent)) {
    return 'other';
  }
  return null;
}

/** This page's URL, asking LINE to open it in the phone's browser. */
export function lineExternalUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set('openExternalBrowser', '1');
  return url.toString();
}
