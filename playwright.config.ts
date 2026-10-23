import { defineConfig } from '@playwright/test';

const iPhoneUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const iPadUA =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// PAGES=1: Test unter dem GitHub-Pages-Pfad /schadstellen-aufmass/ (statischer Server wie GitHub Pages)
const pages = !!process.env.PAGES;
const baseURL = pages ? 'http://localhost:4174/schadstellen-aufmass/' : 'http://localhost:4173/';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
    acceptDownloads: true,
    locale: 'de-DE',
    timezoneId: 'Europe/Vienna',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pc', use: { viewport: { width: 1440, height: 900 } }, testIgnore: /mobile/ },
    {
      name: 'iphone',
      testMatch: /mobile/,
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: iPhoneUA },
    },
    {
      name: 'ipad',
      testMatch: /mobile/,
      use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: iPadUA },
    },
  ],
  webServer: {
    command: pages ? 'node scripts/serve-pages.mjs 4174 /schadstellen-aufmass/' : 'npx vite preview --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
