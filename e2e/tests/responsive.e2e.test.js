import { test, expect } from '@playwright/test';
import { openUnlocked } from '../auth.js';

// Art-directed responsive acceptance checks (ACCEPTANCE-CHECKLIST.md viewports).
// Runs inside the managed e2e webServer (port 3100, in-memory DB) - no
// manual server lifecycle.

const SPECS = [
  { name: '1440x900 desktop', w: 1440, h: 900, coarse: false, art: 'hero-scriptorium-desktop.webp', writeArt: 'hero-scriptorium-desktop.webp' },
  { name: '1280x800 compact desktop', w: 1280, h: 800, coarse: false, art: 'hero-scriptorium-desktop.webp', writeArt: 'hero-scriptorium-desktop.webp' },
  { name: '1180x820 tablet landscape', w: 1180, h: 820, coarse: true, art: 'hero-scriptorium-tablet-landscape.webp', writeArt: 'hero-scriptorium-tablet-landscape.webp' },
  { name: '1024x768 tablet landscape', w: 1024, h: 768, coarse: true, art: 'hero-scriptorium-tablet-landscape.webp', writeArt: 'hero-scriptorium-tablet-landscape.webp' },
  { name: '768x1366 tall tablet portrait', w: 768, h: 1366, coarse: true, art: 'hero-scriptorium-tablet-portrait.webp', writeArt: 'hero-scriptorium-tablet-portrait.webp', portrait: true },
  { name: '800x1280 tablet portrait', w: 800, h: 1280, coarse: true, art: 'hero-scriptorium-tablet-portrait.webp', writeArt: 'hero-scriptorium-tablet-portrait.webp', portrait: true },
  { name: '820x1180 tablet portrait', w: 820, h: 1180, coarse: true, art: 'hero-scriptorium-tablet-portrait.webp', writeArt: 'hero-scriptorium-tablet-portrait.webp', portrait: true },
  { name: '960x1536 android tablet portrait', w: 960, h: 1536, coarse: true, art: 'hero-scriptorium-tablet-portrait.webp', writeArt: 'hero-scriptorium-tablet-portrait.webp', portrait: true },
  { name: '390x844 phone', w: 390, h: 844, coarse: true, art: 'vesper-quill.webp', writeArt: 'vesper-quill.webp' },
];

for (const spec of SPECS) {
  test(`responsive: ${spec.name}`, async ({ browser }, testInfo) => {
    // The viewport matrix already covers phone and tablet sizes with its own
    // contexts; running it again under the Mobile Chrome project is pure
    // duplication and doubles the suite time for zero extra coverage.
    test.skip(testInfo.project.name !== 'chromium', 'viewport matrix runs once, in the chromium project');
    const context = await browser.newContext({
      viewport: { width: spec.w, height: spec.h },
      hasTouch: spec.coarse,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    // The optional scriptorium writing background must resolve to real,
    // decodable assets - not just toggle a class.
    await page.addInitScript(() => {
      localStorage.setItem('st-settings', JSON.stringify({ scriptoriumBg: true }));
    });
    await openUnlocked(page);

    // -- Home: the scriptorium guidance cards are four distinct grid cells
    //    at BASE scope (the coarse-pointer media query must not trap them).
    const home = await page.evaluate(() => {
      const row = document.querySelector('.home-path__row');
      const steps = [...document.querySelectorAll('.home-path__step')];
      const boxes = steps.map((el) => el.getBoundingClientRect());
      const overlap = boxes.some((a, i) => boxes.some((b, j) =>
        i !== j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
      return {
        rowDisplay: row ? getComputedStyle(row).display : null,
        stepCount: steps.length,
        overlap,
        underlined: steps.some((el) => getComputedStyle(el).textDecorationLine.includes('underline')),
      };
    });
    expect(home.rowDisplay).toBe('grid'); // D3 regression: base scope, not trapped
    expect(home.stepCount).toBe(4); // non-vacuous: the cards exist
    expect(home.overlap).toBe(false);
    expect(home.underlined).toBe(false); // deliberate cards, not a link paragraph

    // -- D9: at tablet portrait sizes a useful hero action is FULLY inside
    //    the initial viewport after the header/nav - never a full artwork
    //    scroll away.
    if (spec.portrait) {
      const actionsVisible = await page.evaluate(() => {
        const actions = [...document.querySelectorAll('.hero__actions button:not([hidden]), .hero__actions a:not([hidden])')];
        return actions.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
        }).length;
      });
      expect(actionsVisible).toBeGreaterThan(0);
    }

    // -- The pagination + narration controls live in the Write section.
    await page.locator('#writeBtn').click();
    await expect(page.locator('#writeSection')).toHaveClass(/active/);
    await expect(page.locator('#writeSection')).toHaveClass(/scriptorium-bg/);

    const result = await page.evaluate(() => {
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
      };
      const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (value) => {
        const channels = rgb(value).map((part) => {
          const normalized = part / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const contrast = (foreground, background) => {
        const a = luminance(foreground);
        const b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const workspace = document.getElementById('workspaceNav');
      const workspaceButtons = [...workspace.querySelectorAll('.workspace-nav__btn')];
      const main = document.getElementById('mainContent');
      const manuscript = document.getElementById('storyContent');
      const manuscriptText = manuscript.querySelector('.placeholder');
      const manuscriptStyle = getComputedStyle(manuscript);
      const manuscriptTextStyle = getComputedStyle(manuscriptText);
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        heroImg: (document.querySelector('.hero__picture img') || {}).currentSrc || '',
        heroLine: (document.querySelector('.hero__line') || {}).textContent || '',
        navHeights: [...document.querySelectorAll('.nav-btn')].map((b) => b.getBoundingClientRect().height),
        workspace: {
          position: getComputedStyle(workspace).position,
          box: rect(workspace),
          mainBox: rect(main),
          labels: workspaceButtons.map((button) => button.lastElementChild.textContent),
          buttons: workspaceButtons.map(rect),
        },
        manuscript: {
          background: manuscriptStyle.backgroundColor,
          text: manuscriptTextStyle.color,
          contrast: contrast(manuscriptTextStyle.color, manuscriptStyle.backgroundColor),
        },
        pageButtons: [...document.querySelectorAll('.desk-group--pages button:not([hidden])')].map((b) => {
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          return { h: r.height, w: r.width, background: cs.backgroundColor, color: cs.color, border: cs.borderColor };
        }),
        managementButtons: [...document.querySelectorAll('.desk-group--management button:not([hidden])')].map((b) => {
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          return { h: r.height, w: r.width, background: cs.backgroundColor, color: cs.color };
        }),
        writeBg: getComputedStyle(document.getElementById('writeSection'), '::before').backgroundImage,
      };
    });

    expect(result.overflowX).toBeLessThanOrEqual(1); // no horizontal scroll
    const art = result.heroImg.split('/').pop();
    expect(art).toBe(spec.art); // the right composition for this viewport
    expect(result.heroLine).toContain('Where stories grow claws.');
    if (spec.coarse) {
      for (const h of result.navHeights) expect(h).toBeGreaterThanOrEqual(44);
    }

    // PR 09 shell contract: identical labels and usable targets at every
    // width, expressed as a rail in landscape and a bottom bar otherwise.
    expect(result.workspace.labels).toEqual(['Desk', 'Chronicle', 'Codex', 'Gallery', 'Gate']);
    for (const button of result.workspace.buttons) {
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.width).toBeGreaterThanOrEqual(44);
    }
    const expectsRail = spec.w >= 900 && spec.w > spec.h;
    if (expectsRail) {
      expect(result.workspace.position).toBe('sticky');
      expect(result.workspace.box.right).toBeLessThanOrEqual(result.workspace.mainBox.left + 1);
      expect(new Set(result.workspace.buttons.map((button) => Math.round(button.left))).size).toBe(1);
    } else {
      expect(result.workspace.position).toBe('fixed');
      expect(Math.abs(result.workspace.box.bottom - spec.h)).toBeLessThanOrEqual(1);
      expect(new Set(result.workspace.buttons.map((button) => Math.round(button.top))).size).toBe(1);
    }

    // Optional art frames the desk; the prose plane itself stays opaque,
    // light, and comfortably readable.
    expect(result.manuscript.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(result.manuscript.contrast).toBeGreaterThanOrEqual(4.5);

    // D4 regression: the pagination selector finds REAL buttons (>= 2), they
    // are touch-sized, and none renders as a native grey control.
    expect(result.pageButtons.length).toBeGreaterThanOrEqual(2);
    for (const b of result.pageButtons) {
      expect(b.h).toBeGreaterThanOrEqual(44);
      expect(b.w).toBeGreaterThanOrEqual(44);
      expect(b.background).not.toBe('rgba(0, 0, 0, 0)'); // a themed background
      expect(b.border).not.toBe('rgb(0, 0, 0)'); // a themed border
    }
    // Management actions (Export EPUB / Audiobook / Delete page) are themed
    // and touch-sized too.
    expect(result.managementButtons.length).toBe(3);
    for (const b of result.managementButtons) {
      expect(b.h).toBeGreaterThanOrEqual(44);
      expect(b.w).toBeGreaterThanOrEqual(44);
      expect(b.background).not.toBe('rgba(0, 0, 0, 0)');
    }

    // D5 regression: the writing background pseudo-element references the
    // right asset, and that asset actually loads and decodes.
    const bgUrl = result.writeBg.match(/url\("?([^"]+)"?\)/)?.[1] || '';
    expect(bgUrl.split('/').pop()).toBe(spec.writeArt);
    const decoded = await page.evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok) return { ok: false, status: response.status };
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      return { ok: true, w: bitmap.width, h: bitmap.height };
    }, bgUrl);
    expect(decoded.ok).toBe(true);
    expect(decoded.w).toBeGreaterThan(0);

    expect(errors).toEqual([]);

    await context.close();
  });
}
