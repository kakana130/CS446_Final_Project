import { describe, expect, it } from 'vitest';
import th from '@/messages/th.json';
import { apiErrorKey } from './api';

describe('apiErrorKey', () => {
  it('reaches every API error message (a code missing here would show a generic error)', () => {
    for (const code of Object.keys(th.errors.api)) {
      if (code === 'generic') continue;
      expect(apiErrorKey(code), code).toBe(`api.${code}`);
    }
  });

  it('falls back to the generic message for unknown codes', () => {
    expect(apiErrorKey('something_new')).toBe('api.generic');
  });
});
