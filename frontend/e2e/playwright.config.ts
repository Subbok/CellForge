import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: process.env.CELLFORGE_URL ?? 'http://localhost:8889',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // no webServer — run cellforge-server manually before tests
});
