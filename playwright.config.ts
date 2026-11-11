import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running app backed by a real database and S3 bucket (a deployed test
 * environment, or `npm start` locally with .env.local pointing at them).
 * Mobile-first: the spec's two target viewports. Turnstile uses Cloudflare's test keys.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  },
  // E2E_CHANNEL=msedge (or chrome) drives an installed browser instead of Playwright's download.
  projects: [
    {
      name: 'phone-390',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        channel: process.env.E2E_CHANNEL,
      },
    },
    {
      name: 'phone-360',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 640 },
        channel: process.env.E2E_CHANNEL,
      },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    // The app only accepts writes from APP_ORIGIN; .env.local points it at the dev server.
    env: { APP_ORIGIN: `http://localhost:${PORT}` },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
