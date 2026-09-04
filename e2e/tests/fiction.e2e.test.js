import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { openUnlocked, apiPost, E2E_PASSWORD } from '../auth.js';

async function startFixture(page, overrides = {}) {
  const response = await apiPost(page, '/api/fiction', {
    title: `The reunion ${Date.now()}`, premise: 'Mara returns to the quay.',
    opening: 'Mara waits beside the old bell. Her sister has not arrived.',
    cast: [{ id: 'mara', name: 'Mara', description: 'An old friend.' }, { id: 'sister', name: 'The sister' }],
    ...overrides,
  });
  const story = (await response.json()).story;
  await page.goto(`/#/story/${story.id}`);
  await expect(page.locator('#fictionStoryTitle')).toHaveText(story.title);
  return story;
}

async function approve(page) {
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Continue with AI', exact: true }).click();
}

test.describe('5.0 playable fiction', () => {
  test.beforeEach(async ({ page }) => openUnlocked(page));

  test('starts a reader-director story without choosing an avatar or making a paid call', async ({ page }) => {
    let paid = 0;
    await page.route('**/api/fiction/*/replies', () => { paid++; });
    await page.getByRole('link', { name: 'Start a story', exact: true }).click();
    await page.getByLabel('Story title', { exact: true }).fill('A garden opens');
    await page.getByLabel('The situation', { exact: true }).fill('An abandoned garden opens to its neighbours.');
    await page.getByRole('button', { name: 'Begin this story' }).click();
    await expect(page.locator('#fictionStoryTitle')).toHaveText('A garden opens');
    await expect(page.locator('#fictionControl')).toContainText('reader-director');
    await expect(page.locator('#fictionInputKind option')).toHaveCount(2);
    expect(paid).toBe(0);
  });

  test('resumes saved prose without administration or a provider request', async ({ page }) => {
    const story = await startFixture(page);
    await page.getByRole('link', { name: 'Your stories', exact: true }).click();
    await page.locator('.fiction-card', { hasText: story.title }).getByRole('link', { name: 'Return to this story' }).click();
    await expect(page.locator('#fictionProse')).toContainText('Mara waits beside the old bell.');
    await expect(page.locator('#fictionDetails')).toBeHidden();
    await page.reload();
    await expect(page.locator('#fictionProse')).toContainText('Her sister has not arrived.');
  });

  test('authored openings include a cast without requiring an avatar or exposing the solution', async ({ page }) => {
    await page.getByRole('link', { name: 'Start a story', exact: true }).click();
    await page.getByRole('button', { name: 'Begin with The Drowned Bell', exact: true }).click();
    await page.getByRole('button', { name: 'Begin this story' }).click();
    await expect(page.locator('#fictionProse')).toContainText('The bell had been underwater');
    await expect(page.locator('#fictionControl')).toContainText('reader-director');
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await expect(page.locator('#fictionCast')).toContainText('Iona');
    await expect(page.locator('#fictionDetails')).not.toContainText('Vale is the buyer');
  });

  test('preferences and fact retirement are explicit local changes', async ({ page }) => {
    const story = await startFixture(page, { facts: [{ id: 'old', text: 'An old detail.' }] });
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await page.getByRole('button', { name: 'Story preferences', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Pacing', { exact: true }).selectOption('reflective');
    await page.getByRole('dialog').getByLabel('Narration voice', { exact: true }).fill('Warm, unhurried prose.');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const saved = await (await page.request.get(`/api/fiction/${story.id}`)).json();
    expect(saved.story.state.voice).toBe('Warm, unhurried prose.');
    await page.getByRole('button', { name: 'Retire a fact', exact: true }).click();
    await page.getByLabel('Reason for retiring it').fill('No longer relevant.');
    await page.getByRole('button', { name: 'Retire this fact', exact: true }).click();
    await expect(page.locator('#fictionFacts')).not.toContainText('An old detail.');
  });

  test('character inhabiting requires an explicit handoff and can be released', async ({ page }) => {
    await startFixture(page);
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await page.getByRole('button', { name: 'Inhabit Mara', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('You will decide');
    await page.getByRole('button', { name: 'Take this role', exact: true }).click();
    await expect(page.locator('#fictionControl')).toContainText('You control Mara');
    await expect(page.locator('#fictionInputKind option')).toHaveCount(4);
    await page.getByRole('button', { name: 'Return to reader-director', exact: true }).click();
    await expect(page.locator('#fictionControl')).toContainText('reader-director');
    await expect(page.locator('#fictionInputKind option')).toHaveCount(2);
  });

  test('corrects a fact and keeps it after reload without changing earlier prose', async ({ page }) => {
    await startFixture(page);
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await page.getByRole('button', { name: 'Correct a story fact' }).click();
    await page.getByLabel('What is true?').fill('Mara promised to protect her sister.');
    await page.getByLabel('Why are you correcting it?').fill('The promise was missing.');
    await page.getByRole('button', { name: 'Save correction', exact: true }).click();
    await expect(page.locator('#fictionFacts')).toContainText('promised to protect');
    await page.reload();
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await expect(page.locator('#fictionFacts')).toContainText('promised to protect');
    await expect(page.locator('#fictionProse')).toContainText('Her sister has not arrived.');
  });

  test('rewind restores complete state while retaining the original path', async ({ page }) => {
    const story = await startFixture(page);
    await apiPost(page, `/api/fiction/${story.id}/corrections`, { expected_revision: story.revision, fact: { id: 'promise', kind: 'commitment', text: 'Mara promised to conceal the sale.', actor_id: 'mara' }, reason: 'A commitment.' });
    await page.reload();
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await expect(page.locator('#fictionFacts')).toContainText('conceal the sale');
    await page.getByRole('button', { name: 'Rewind a choice' }).click();
    await page.getByLabel('Continue from after this moment').selectOption(story.head_beat_id);
    await page.getByLabel('Name this path').fill('Without the promise');
    await page.getByRole('button', { name: 'Create this path', exact: true }).click();
    await expect(page.locator('#fictionFacts')).not.toContainText('conceal the sale');
    await page.locator('#fictionBranch').selectOption(story.active_branch_id);
    await expect(page.locator('#fictionFacts')).toContainText('conceal the sale');
  });

  test('hidden world facts do not appear in the reader recap', async ({ page }) => {
    await startFixture(page, { facts: [{ id: 'secret', text: 'The mayor bought the map.', visibility: 'secret', known_by: ['mara'] }] });
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await expect(page.locator('#fictionDetails')).not.toContainText('mayor');
  });

  test('ends and starts episodes without calling a provider', async ({ page }) => {
    await startFixture(page);
    await page.getByRole('button', { name: 'Cast & story' }).click();
    await page.getByRole('button', { name: 'End this episode', exact: true }).click();
    await page.getByLabel('A short recap (optional)').fill('They can finally talk.');
    await page.getByRole('button', { name: 'End episode', exact: true }).click();
    await expect(page.locator('#fictionEnded')).toBeVisible();
    await expect(page.locator('#fictionComposer')).toBeHidden();
    await page.reload();
    await expect(page.locator('#fictionEnded')).toContainText('They can finally talk.');
    await page.getByRole('button', { name: 'Begin another episode', exact: true }).click();
    await page.getByLabel('Episode title', { exact: true }).fill('The visit');
    await page.getByRole('button', { name: 'Begin episode', exact: true }).click();
    await expect(page.locator('#fictionEpisode')).toContainText('Episode 2');
  });

  test('paid review cancellation preserves the direction', async ({ page }) => {
    await startFixture(page);
    await page.locator('#fictionDirection').fill('Let them speak privately.');
    await page.getByRole('button', { name: 'Send direction' }).click();
    await expect(page.getByRole('dialog')).toContainText('hidden world truth');
    await page.keyboard.press('Escape');
    await expect(page.locator('#fictionDirection')).toHaveValue('Let them speak privately.');
    await expect(page.locator('#fictionContinue')).toBeEnabled();
  });

  test('slow replies provide immediate feedback and cannot double-submit', async ({ page }) => {
    const story = await startFixture(page); let count = 0; let release;
    await page.route('**/api/fiction/*/replies', async (route) => {
      count++;
      await new Promise((resolve) => { release = resolve; });
      await route.fulfill({ json: { story, cost_usd: 0.01, billed_attempts: 1 } });
    });
    await page.locator('#fictionContinue').click();
    await expect(page.locator('#fictionContinue')).toBeDisabled();
    await approve(page);
    await expect.poll(() => count).toBe(1);
    await expect(page.locator('#fictionActionStatus')).toContainText('handled');
    await page.locator('#fictionSend').evaluate((node) => node.click());
    expect(count).toBe(1);
    release(); await expect(page.locator('#fictionContinue')).toBeEnabled();
  });

  test('a late reply cannot move the reader back from the shelf', async ({ page }) => {
    const story = await startFixture(page); let release;
    await page.route('**/api/fiction/*/replies', async (route) => {
      await new Promise((resolve) => { release = resolve; });
      await route.fulfill({ json: { story } });
    });
    await page.locator('#fictionContinue').click(); await approve(page);
    await expect.poll(() => Boolean(release)).toBe(true);
    await page.getByRole('link', { name: 'Your stories', exact: true }).click();
    await expect(page.locator('#shelfScreen')).toBeVisible(); release();
    await expect(page.locator('#readerScreen')).toBeHidden();
  });

  test('failed paid work keeps the draft and does not retry automatically', async ({ page }) => {
    await startFixture(page); let count = 0;
    await page.route('**/api/fiction/*/replies', async (route) => {
      count++; await route.fulfill({ status: 502, json: { error: 'The story response was invalid.', billed_attempts: 1, cost_usd: 0.01 } });
    });
    await page.locator('#fictionDirection').fill('Keep the reunion quiet.');
    await page.getByRole('button', { name: 'Send direction' }).click(); await approve(page);
    await expect(page.locator('#fictionStatus')).toContainText('invalid');
    await expect(page.locator('#fictionDirection')).toHaveValue('Keep the reunion quiet.');
    await expect(page.locator('#fictionContinue')).toBeEnabled(); expect(count).toBe(1);
  });

  test('locking clears prose and requires authentication again', async ({ page }) => {
    await startFixture(page);
    await page.locator('#lockBtn').click();
    await expect(page.locator('#authLoginForm')).toBeVisible();
    await expect(page.locator('.container')).toBeHidden();
    await expect(page.locator('#fictionProse')).toBeEmpty();
    expect((await page.request.get('/api/fiction')).status()).toBe(401);
    await page.locator('#authPassword').fill(E2E_PASSWORD);
    await page.locator('#authLoginForm button[type="submit"]').click();
    await expect(page.locator('#fictionProse')).toContainText('Mara waits');
  });

  test('core surfaces have no detected WCAG A/AA violations', async ({ page }) => {
    test.setTimeout(60000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const story = await startFixture(page);
    for (const route of ['/#/stories', '/#/new', `/#/story/${story.id}`, '/#/settings']) {
      await page.goto(route);
      await page.waitForFunction(() => !document.body.classList.contains('im-gated'));
      await expect(page.locator('#fictionMain h1:visible')).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(result.violations, `${route}: ${result.violations.map((item) => item.id).join(', ')}`).toEqual([]);
    }
  });

  test('reading and controls reflow on narrow and enlarged layouts', async ({ page }) => {
    await startFixture(page);
    for (const width of [320, 390, 768, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.documentElement.style.setProperty('--fiction-reading-size', '24px'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await expect(page.locator('#fictionContinue')).toBeVisible();
    }
  });
});
