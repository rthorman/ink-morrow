// Captures current screenshots for the README from a fresh in-memory server
// with a small seeded tale. Diagnostic + documentation artifact.
const { chromium } = require('playwright-core');
const CHROMIUM_PATH = '/data/data/com.termux/files/usr/bin/chromium-browser';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const server = spawn('node', ['../backend/server.js'], {
    env: { ...process.env, DB_PATH: ':memory:', PORT: String(PORT), NODE_ENV: 'production', OPENROUTER_API_KEY: '' },
    stdio: 'ignore',
  });
  try {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await wait(250);
      try {
        const res = await fetch(`${BASE}/api/worlds`);
        up = res.ok;
      } catch { /* booting */ }
    }
    if (!up) throw new Error('server did not boot');

    // Seed a small tale through the API (no paid calls - the API key is empty)
    const world = (await (await fetch(`${BASE}/api/worlds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'The Ashen Marches', description: 'A drowned kingdom of candle-lit bridges', genre: 'Gothic fantasy', setting: 'Drowned kingdom', generate_image: false }) })).json()).world;
    const hero = (await (await fetch(`${BASE}/api/characters`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Vess of the Last Bridge', description: 'A toll-keeper who stopped charging', personality: 'Patient, unhurried, quietly grieving', appearance: 'Rain-dark cloak, iron lantern', background: 'Kept the bridge when the kingdom sank', world_id: world.id, generate_image: false }) })).json()).character;
    const story = (await (await fetch(`${BASE}/api/stories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'The Toll of Quiet Years', world_id: world.id, tone: 'fade-to-black', characters: [{ id: hero.id, role: 'mc', relation: null, state: null }] }) })).json()).story;
    await fetch(`${BASE}/api/stories/${story.id}/pages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'The rain had been falling on the Ashen Marches for nine years, and Vess had kept her lantern lit for every one of them. Tonight the water rose again, patient as a creditor, and the bridge groaned under the weight of another tide.' }) });

    const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
    const outDir = path.join('..', 'docs', 'screenshots');
    fs.mkdirSync(outDir, { recursive: true });

    const shots = [
      { name: 'home-desktop', url: `${BASE}/#/home`, viewport: { width: 1440, height: 900 } },
      { name: 'write-desktop', url: `${BASE}/#/write/${story.id}`, viewport: { width: 1440, height: 900 } },
      { name: 'home-tablet-portrait', url: `${BASE}/#/home`, viewport: { width: 768, height: 1366 } },
      { name: 'write-tablet-portrait', url: `${BASE}/#/write/${story.id}`, viewport: { width: 768, height: 1366 } },
      { name: 'library-desktop', url: `${BASE}/#/library/stories`, viewport: { width: 1440, height: 900 } },
      { name: 'worlds-desktop', url: `${BASE}/#/worlds`, viewport: { width: 1440, height: 900 } },
    ];
    for (const shot of shots) {
      const page = await browser.newPage({ viewport: shot.viewport });
      await page.goto(shot.url);
      await page.addInitScript(() => { try { window.localStorage.setItem('fw-age-ok', '1'); } catch { /* fresh context */ } });
      await page.goto(shot.url);
      await wait(700);
      await page.screenshot({ path: path.join(outDir, `${shot.name}.png`), fullPage: false });
      await page.close();
      console.log('captured', shot.name);
    }
    await browser.close();
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
