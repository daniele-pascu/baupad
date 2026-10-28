import { defineConfig } from '@playwright/test';

/** Screenshots für die Website (scripts/site-shots) – kein Bestandteil der Tests */
const iPhoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export default defineConfig({
  testDir: 'scripts/site-shots',
  outputDir: 'test-results/site-shots',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    permissions: ['camera'],
    acceptDownloads: true,
    locale: 'de-DE',
    timezoneId: 'Europe/Vienna',
  },
  projects: [
    { name: 'pc', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 }, testIgnore: /mobile/ },
    { name: 'iphone', testMatch: /mobile/, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: iPhoneUA } },
  ],
  webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: true, timeout: 60_000 },
});
