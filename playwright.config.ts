import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end handoff tests
 * (Customer → Store → Driver, plus cancel + conflict).
 *
 * Required env vars (see e2e/README.md):
 *   E2E_BASE_URL              http(s) URL of a running preview / published build
 *   E2E_CUSTOMER_EMAIL/PASS   seeded customer login
 *   E2E_STORE_EMAIL/PASS      seeded store-owner login (must own E2E_STORE_ID)
 *   E2E_DRIVER_EMAIL/PASS     seeded active driver login
 *   E2E_DRIVER2_EMAIL/PASS    second driver (used for accept-conflict test)
 *   E2E_STORE_ID              uuid of the store the customer will order from
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // tests share live data; run serially
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'el-GR',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
