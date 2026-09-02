#!/usr/bin/env node
'use strict';

// Playwright 1.62+ can use Termux's native Chromium without patching its
// installed package, provided the Android process does not ask Playwright for
// an unsupported default browser-cache directory during module loading.
if (process.platform === 'android' && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

require('@playwright/test/cli');
