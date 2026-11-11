import { describe, expect, it } from 'vitest';
import { inAppBrowser, lineExternalUrl } from './inapp';

const UA = {
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.16.0',
  facebook:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0',
  webview:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36',
  chrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

describe('inAppBrowser', () => {
  it('spots LINE, which can be asked to open the real browser', () => {
    expect(inAppBrowser(UA.line)).toBe('line');
  });

  it('spots other in-app browsers and Android web views', () => {
    expect(inAppBrowser(UA.facebook)).toBe('other');
    expect(inAppBrowser(UA.instagram)).toBe('other');
    expect(inAppBrowser(UA.webview)).toBe('other');
  });

  it('leaves real browsers alone', () => {
    expect(inAppBrowser(UA.chrome)).toBeNull();
    expect(inAppBrowser(UA.safari)).toBeNull();
  });
});

describe('lineExternalUrl', () => {
  it('adds the flag and keeps the rest of the URL', () => {
    expect(lineExternalUrl('https://example.test/lost?x=1#top')).toBe(
      'https://example.test/lost?x=1&openExternalBrowser=1#top',
    );
  });
});
