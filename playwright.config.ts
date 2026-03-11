import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:    './tests/e2e',
  timeout:    45_000,
  retries:    1,
  reporter:   [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL:    'http://localhost:3000',
    headless:   true,
    trace:      'on-first-retry',
  },
  webServer: {
    command:             'npm run dev',
    url:                 'http://localhost:3000',
    reuseExistingServer: true,
    timeout:             60_000,
  },
});
