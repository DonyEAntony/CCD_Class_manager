const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'communications-ui.spec.js',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3101', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  globalSetup: require.resolve('./tests/fixtures/communication-setup'),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
