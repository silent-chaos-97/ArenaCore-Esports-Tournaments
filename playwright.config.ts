import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tournament simulation against the real stack (compose services must be running).
 * Playwright starts the API (rate limits off for scripted sign-ups), the worker and the web app.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @arenacore/api dev',
      url: 'http://localhost:4000/api/v1/health/ready',
      env: { DISABLE_RATE_LIMIT: 'true', MFA_ENFORCED: 'false' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @arenacore/api dev:worker',
      url: 'http://localhost:9464/metrics',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: process.env.CI
        ? 'pnpm --filter @arenacore/web build && pnpm --filter @arenacore/web start'
        : 'pnpm --filter @arenacore/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
