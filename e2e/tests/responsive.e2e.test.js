import { test, expect } from '@playwright/test';

// Art-directed responsive acceptance checks (ACCEPTANCE-CHECKLIST.md viewports).
// Runs inside the managed e2e webServer (port 3100, in-memory DB) - no
// manual server lifecycle.

const SPECS = [
  { name: '1440x900 desktop', w: 1440, h: 900, coarse: false, art: 'hero-scriptorium-desktop.webp' },
  { name: '1280x800 compact desktop', w: 1280, h: 800, coarse: false, art: 'hero-scriptorium-desktop.webp' },
  { name: '1180x820 tablet landscape', w: 1180, h: 820, coarse: true, art: 'hero-scriptorium-tablet-landscape.webp' },
  { name: '1024x768 tablet landscape', w: 1024, h: 768, coarse: true, art: 'hero-scriptorium-tablet-landscape.webp' },
  { name: '768x1366 tall tablet portrait', w: 768, h: 1366, coarse: true, art: 'hero-scriptorium-tablet-portrait.webp' },
  { name: '800x1280 tablet portrait', w: 800, h: 1280, coarse: true, art: 'hero-scriptorium-tablet-portrait.webp' },
  { name: '820x1180 tablet portrait', w: 820, h: 1180, coarse: true, art: 'hero-scriptorium-tablet-portrait.webp' },
  { name: '390x844 phone', w: 390, h: 844, coarse: true, art: 'vesper-quill.webp' },
];

for (const spec of SPECS) {
  test(`responsive: ${spec.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: spec.w, height: spec.h },
      hasTouch: spec.coarse,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto('/');
    await page.waitForSelector('.container');

    const gate = page.locator('#ageGate');
    if (await gate.isVisible()) {
      await page.locator('#ageGateAccept').click();
      await expect(gate).toBeHidden();
    }

    // The pagination + narration controls live in the Write section.
    await page.locator('#writeBtn').click();
    await expect(page.locator('#writeSection')).toHaveClass(/active/);

    const result = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      heroImg: (document.querySelector('.hero__picture img') || {}).currentSrc || '',
      heroLine: (document.querySelector('.hero__line') || {}).textContent || '',
      navHeights: [...document.querySelectorAll('.nav-btn')].map((b) => b.getBoundingClientRect().height),
      writeNavHeights: [...document.querySelectorAll('.page-navigation button:not([hidden])')].map(
        (b) => b.getBoundingClientRect().height
      ),
    }));

    expect(result.overflowX).toBeLessThanOrEqual(1); // no horizontal scroll
    const art = result.heroImg.split('/').pop();
    expect(art).toBe(spec.art); // the right composition for this viewport
    expect(result.heroLine).toContain('Where stories grow claws.');
    if (spec.coarse) {
      for (const h of result.navHeights) expect(h).toBeGreaterThanOrEqual(44);
    }
    for (const h of result.writeNavHeights) expect(h).toBeGreaterThanOrEqual(44); // pagination + narration controls
    expect(errors).toEqual([]);

    await context.close();
  });
}