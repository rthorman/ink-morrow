// Captures current screenshots for the README from a fresh in-memory server
// with a small seeded tale. This is a documentation helper, not a test.
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROMIUM_PATH = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  '/data/data/com.termux/files/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && fs.existsSync(candidate));
const SETUP_CODE = 'SCREENSHOT-SETUP-CODE';
const PASSWORD = 'The screenshot scriptorium phrase';
const PORT = 3211;
const BASE = `http://localhost:${PORT}`;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function apiJson(page, requestPath, method, body) {
  return page.evaluate(async ({ requestPath: target, method: verb, body: payload }) => {
    const statusResponse = await fetch('/api/auth/status', { cache: 'no-store' });
    const status = await statusResponse.json();
    if (!statusResponse.ok || !status.csrf_token) throw new Error('Screenshot session is not unlocked');
    const response = await fetch(target, {
      method: verb,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-InkMorrow-CSRF': status.csrf_token,
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Screenshot seed request failed (${response.status})`);
    return result;
  }, { requestPath, method, body });
}

async function apiUpload(page, requestPath, { bytes, filename, mediaType, title, altText, afterPageId }) {
  return page.evaluate(async ({ requestPath: target, bytes: encoded, filename: name, mediaType: type, title: assetTitle, altText: alt, afterPageId: anchor }) => {
    const statusResponse = await fetch('/api/auth/status', { cache: 'no-store' });
    const status = await statusResponse.json();
    if (!statusResponse.ok || !status.csrf_token) throw new Error('Screenshot session is not unlocked');
    const raw = atob(encoded);
    const data = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    const form = new FormData();
    form.append('image', new File([data], name, { type }));
    form.append('title', assetTitle);
    form.append('alt_text', alt);
    form.append('after_page_id', anchor);
    form.append('provider_reference_allowed', 'false');
    const response = await fetch(target, {
      method: 'POST', credentials: 'same-origin', headers: { 'X-InkMorrow-CSRF': status.csrf_token }, body: form,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Screenshot upload failed (${response.status})`);
    return result;
  }, { requestPath, bytes, filename, mediaType, title, altText, afterPageId });
}

async function main() {
  const server = spawn('node', ['../backend/server.js'], {
    env: {
      ...process.env,
      DB_PATH: ':memory:',
      PORT: String(PORT),
      NODE_ENV: 'e2e',
      AUTH_SETUP_CODE: SETUP_CODE,
      OPENROUTER_API_KEY: '',
    },
    stdio: 'ignore',
  });
  let browser;
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await wait(250);
      try {
        const response = await fetch(`${BASE}/api/auth/status`);
        up = response.ok;
      } catch { /* booting */ }
    }
    if (!up) throw new Error('server did not boot');

    const launchOptions = CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {};
    browser = await chromium.launch(launchOptions);
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try { window.localStorage.setItem('fw-age-ok', '1'); } catch { /* fresh context */ }
    });

    // Establish the owner session before any protected seed API is called.
    const setupPage = await context.newPage();
    await setupPage.goto(`${BASE}/#/library`);
    await setupPage.waitForSelector('#authSetupForm');
    await setupPage.fill('#authSetupCode', SETUP_CODE);
    await setupPage.fill('#authNewPassword', PASSWORD);
    await setupPage.fill('#authConfirmPassword', PASSWORD);
    await setupPage.locator('#authSetupForm button[type="submit"]').click();
    await setupPage.waitForFunction(() => !document.body.classList.contains('im-gated'));

    // Seed a small tale through the authenticated API (no paid calls).
    const world = (await apiJson(setupPage, '/api/worlds', 'POST', {
      name: 'The Ashen Marches',
      description: 'A drowned kingdom of candle-lit bridges',
      genre: 'Gothic fantasy',
      setting: 'Drowned kingdom',
      generate_image: false,
    })).world;
    const hero = (await apiJson(setupPage, '/api/characters', 'POST', {
      name: 'Vess of the Last Bridge',
      description: 'A toll-keeper who stopped charging',
      personality: 'Patient, unhurried, quietly grieving',
      appearance: 'Rain-dark cloak, iron lantern',
      background: 'Kept the bridge when the kingdom sank',
      world_id: world.id,
      generate_image: false,
    })).character;
    const story = (await apiJson(setupPage, '/api/stories', 'POST', {
      title: 'The Toll of Quiet Years',
      world_id: world.id,
      tone: 'fade-to-black',
      characters: [{ id: hero.id, role: 'mc', relation: null, state: null }],
    })).story;
    const seededPage = (await apiJson(setupPage, `/api/stories/${story.id}/pages`, 'POST', {
      content: 'The rain had been falling on the Ashen Marches for nine years, and Vess had kept her lantern lit for every one of them. Tonight the water rose again, patient as a creditor, and the bridge groaned under the weight of another tide.',
    })).page;
    await apiUpload(setupPage, `/api/stories/${story.id}/assets/upload`, {
      bytes: fs.readFileSync(path.join('..', 'frontend', 'brand', 'cinder-cast.webp')).toString('base64'),
      filename: 'ashen-marches.webp',
      mediaType: 'image/webp',
      title: 'Lantern at the Last Bridge',
      altText: 'A cat-eared illuminator working beside a glowing manuscript in a gothic archive.',
      afterPageId: seededPage.id,
    });
    await setupPage.close();

    const outDir = path.join('..', 'docs', 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const shots = [
      { name: 'home-desktop', url: `${BASE}/#/library`, viewport: { width: 1440, height: 900 } },
      { name: 'write-desktop', url: `${BASE}/#/desk/${story.id}`, viewport: { width: 1440, height: 900 } },
      { name: 'home-tablet-portrait', url: `${BASE}/#/library`, viewport: { width: 768, height: 1366 } },
      { name: 'write-tablet-portrait', url: `${BASE}/#/desk/${story.id}`, viewport: { width: 768, height: 1366 } },
      { name: 'library-desktop', url: `${BASE}/#/library/stories`, viewport: { width: 1440, height: 900 } },
      { name: 'worlds-desktop', url: `${BASE}/#/worlds`, viewport: { width: 1440, height: 900 } },
      { name: 'codex-desktop', url: `${BASE}/#/codex/${story.id}`, viewport: { width: 1440, height: 900 } },
      { name: 'gallery-desktop', url: `${BASE}/#/gallery/${story.id}`, viewport: { width: 1440, height: 900 } },
    ];
    for (const shot of shots) {
      const page = await context.newPage();
      await page.setViewportSize(shot.viewport);
      await page.goto(shot.url);
      await page.waitForSelector('.container', { state: 'visible' });
      await wait(700);
      await page.screenshot({ path: path.join(outDir, `${shot.name}.png`), fullPage: false });
      await page.close();
      console.log('captured', shot.name);
    }
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
