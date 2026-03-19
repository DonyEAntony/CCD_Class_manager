const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const port = Number(process.env.PLAYWRIGHT_PORT || 3100);
const dbPath = path.join(__dirname, 'test-results', 'playwright.sqlite');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node app.js',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: process.env.SESSION_SECRET || 'playwright-session-secret',
      ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@stmatthew.org',
      ADMIN_INVITE_CODE: process.env.ADMIN_INVITE_CODE || 'stmat-admin-code',
      CATECHIST_INVITE_CODE: process.env.CATECHIST_INVITE_CODE || 'stmat-catechist-code',
      DB_PATH: process.env.DB_PATH || dbPath,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
