import 'server-only';
import { toDbError } from './errors';
import { query } from './server';

export interface SiteSettings {
  mode: 'active' | 'dormant';
  bannerTh: string | null;
  bannerEn: string | null;
}

const TTL_MS = 30_000;
let cache: { at: number; value: SiteSettings } | undefined;

/** Site mode and banner, cached briefly per server instance (admin changes apply within 30 s). */
export async function getSiteSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { data, error } = await query<{
    mode: SiteSettings['mode'];
    banner_th: string | null;
    banner_en: string | null;
  }>('select mode, banner_th, banner_en from public.site_settings where id = 1');
  if (error) throw toDbError('site_settings', error);
  const row = data[0];
  if (!row) throw toDbError('site_settings', { code: 'no_row' });
  const value: SiteSettings = {
    mode: row.mode,
    bannerTh: row.banner_th,
    bannerEn: row.banner_en,
  };
  cache = { at: Date.now(), value };
  return value;
}
