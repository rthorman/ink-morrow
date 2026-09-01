import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'fs';

// Prefer an explicit/native Chromium when Playwright's managed browser is not
// available (Termux and contributor machines using the tested system Chrome).
const nativeChromiumPath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/data/data/com.termux/files/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate));
const nativeChromium = nativeChromiumPath
  ? {
      launchOptions: {
        executablePath: nativeChromiumPath,
        args: nativeChromiumPath.startsWith('/data/data/com.termux/')
          ? ['--no-sandbox', '--disable-dev-shm-usage']
          : [],
      },
    }
  : {};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...nativeChromium } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'], ...nativeChromium } },
  ],
  // The backend serves both the API and the frontend, so one server is enough.
  // Run node directly (not `npm start`): the npm wrapper shields the server
  // process from Playwright's webServer teardown on Termux.
  webServer: {
    // Keep the command portable across Windows and POSIX shells. Playwright
    // passes the isolated test configuration through the explicit env below.
    command: 'node server.js',
    cwd: '../backend',
    port: 3100,
    // Never reuse a server on the port: the user's dev server runs on 3000
    // and e2e must not touch it or its database.
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'e2e',
      PORT: '3100',
      // Fresh in-memory DB per e2e server start: desktop and mobile
      // projects must not see each other's data.
      DB_PATH: ':memory:',
      // Guard against a real API key being picked up during e2e runs:
      // these tests mock the AI endpoint via page.route.
      OPENROUTER_API_KEY: 'e2e-dummy-key',
      AUTH_SETUP_CODE: 'E2E-SETUP-CODE',
    },
  },
});
