'use strict';

// Flat config, one linter for the whole repo. Environments differ per corner:
// backend runs in Node, the frontend script runs in the browser AND in jsdom
// (jest), and the e2e tests are ESM. Termux note: always run through
// `npm run lint` — it invokes eslint via node directly, sidestepping the
// broken .bin shebangs.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      'database/**',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
      'ScribeTribe-OpenCode-Branding/**',
      'frontend/brand/**',
    ],
  },

  js.configs.recommended,

  {
    // Backend: Node + CommonJS
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    // Backend tests add the Jest globals
    files: ['backend/tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },

  {
    // Frontend: the app script runs in the browser AND under jest/jsdom, so
    // it carries both worlds' globals (module/process are guarded).
    files: ['frontend/script.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.browser, ...globals.node },
    },
  },

  {
    files: ['frontend/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.browser, ...globals.node, ...globals.jest },
    },
  },

  {
    // E2E: ESM + Playwright's imports. Browser globals appear inside
    // page.evaluate() callbacks, which run in the page, not in Node.
    files: ['e2e/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['e2e/playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['e2e/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  {
    rules: {
      // Express signatures and DOM guards legitimately drop arguments and
      // caught errors; the codebase comments empty catches on purpose.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
];
