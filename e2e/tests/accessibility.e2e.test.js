import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { apiPost, openUnlocked } from '../auth.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectAccessible(page, label) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations, `${label}: ${results.violations.map((item) => item.id).join(', ')}`)
    .toEqual([]);
}

test.describe('PR 18 WCAG automation', () => {
  test('critical owner surfaces and public reading copy have no WCAG A/AA violations', async ({ page }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openUnlocked(page);
    const storyResponse = await apiPost(page, '/api/stories', {
      title: `Accessible Fixture ${Date.now()}`,
      characters: [],
    });
    const story = (await storyResponse.json()).story;
    await apiPost(page, `/api/stories/${story.id}/pages`, {
      content: 'A readable paragraph for automated accessibility checks.',
      user_input: null,
    });

    const ownerSurfaces = [
      ['Library', '/#/library', '#homeSection.active, #librarySection.active'],
      ['Desk', `/#/desk/${story.id}/page/1`, '#writeSection.active'],
      ['Chronicle', `/#/chronicle/${story.id}`, '#chronicleSection.active'],
      ['Codex', `/#/codex/${story.id}`, '#codexSection.active'],
      ['Gallery', `/#/gallery/${story.id}`, '#gallerySection.active'],
      ['Gate', `/#/gate/${story.id}`, '#gateSection.active'],
    ];
    for (const [label, target, ready] of ownerSurfaces) {
      await page.goto(target);
      await page.waitForSelector(ready, { state: 'visible' });
      if (label === 'Desk') {
        await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1');
        await expect(page.locator('#writeSection .writing-interface')).not.toHaveClass(/read-only/);
        await expect(page.locator('#storyNewBtn')).toBeEnabled();
      }
      await page.waitForTimeout(50);
      await expectAccessible(page, label);
    }

    const snapshotResponse = await apiPost(page, `/api/stories/${story.id}/publications`, {
      front_matter: [{ role: 'preface', title: 'Before the tale', text: 'A public preface.' }],
      back_matter: [{ role: 'afterword', title: 'After the tale', text: 'A public afterword.' }],
    });
    const snapshot = (await snapshotResponse.json()).snapshot;
    const shareResponse = await apiPost(page, `/api/publications/${snapshot.id}/shares`, {});
    const share = (await shareResponse.json()).share;
    await page.goto(share.share_url);
    await expect(page.locator('#shareDocument')).toBeVisible();
    await expect(page.locator('#shareDocument')).toContainText('A public preface.');
    await expect(page.locator('#shareDocument')).toContainText('A public afterword.');
    await expectAccessible(page, 'Public reading copy');
  });

  test('locked threshold is named and keyboard reachable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openUnlocked(page);
    await page.locator('#lockBtn').click();
    await expect(page.locator('#authLoginForm')).toBeVisible();
    await expectAccessible(page, 'Locked threshold');
    await expect(page.locator('#authPassword')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.auth-password__toggle[aria-controls="authPassword"]')).toBeFocused();
  });
});
