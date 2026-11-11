import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { apiHeaders, securityHeaders } from './lib/security/headers';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Needed because every root layout sits under [locale] (plus /admin later).
    globalNotFound: true,
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: apiHeaders },
    ];
  },
};

export default withNextIntl(nextConfig);
