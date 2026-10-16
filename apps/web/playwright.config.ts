import { defineConfig, devices } from '@playwright/test';

const isCI = process.env.CI === 'true';
// E2E_WEB_PORT moves the web app off 3000 when something else already listens there locally.
const port = process.env.E2E_WEB_PORT ?? '3000';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    {
      name: 'chromium',
      // Locally, use the installed Google Chrome so no browser download is needed.
      // CI installs Playwright's own Chromium (`playwright install --with-deps chromium`).
      use: { ...devices['Desktop Chrome'], ...(isCI ? {} : { channel: 'chrome' }) },
    },
  ],
  // Runs the production build (`next build` must have run first).
  webServer: {
    command: 'pnpm run start',
    url: `http://127.0.0.1:${port}/health`,
    env: { PORT: port },
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
