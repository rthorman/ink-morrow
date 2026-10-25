const { defineConfig, devices } = require('@playwright/test');
const { existsSync } = require('node:fs');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
module.exports = defineConfig({
  testDir: './tests', testMatch: 'recovery-prototype.e2e.test.js', workers: 1,
  forbidOnly: !!process.env.CI, reporter: 'list',
  use: { screenshot: 'only-on-failure', launchOptions: { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } },
  projects: [
    { name: 'tablet portrait', use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 1280 }, hasTouch: true } },
    { name: 'tablet landscape', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, hasTouch: true } },
    { name: 'phone', use: { ...devices['Pixel 5'] } },
  ],
});
