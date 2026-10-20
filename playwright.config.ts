import { defineConfig, devices } from '@playwright/test';

// Browser tests of the built SDK (`dist/ui-kit.iife.js`) on a bare static page: tests/e2e/server.mjs.
const port = Number(process.env.SDK_E2E_PORT ?? 3006);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'node tests/e2e/server.mjs', env: { PORT: String(port) }, url: baseURL, reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
