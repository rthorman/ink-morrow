import { test, expect } from '@playwright/test';
import { apiPost, openUnlocked } from '../auth.js';

// Shared helpers kept local (the other e2e files duplicate these too).
async function createStoryViaUi(page, title) {
  await openUnlocked(page);
  const worldRes = await apiPost(page, '/api/worlds', { name: `${title} World` });
  const world = (await worldRes.json()).world;
  const charRes = await apiPost(page, '/api/characters', { name: `${title} Protagonist`, world_id: world.id });
  const character = (await charRes.json()).character;
  const storyRes = await apiPost(page, '/api/stories', {
    title, world_id: world.id, characters: [{ id: character.id, role: 'mc', relation: null, state: null }],
  });
  const story = (await storyRes.json()).story;

  await openUnlocked(page);
  await page.locator('#writeBtn').click();
  await page.selectOption('#shellManuscriptSelect', story.id);
  await expect(page.locator('#writeSection')).toHaveClass(/active/);
  return story;
}

const SPEECH_MODELS = [
  { id: 'or/voice-1', name: 'Voice One', pcm: false, voices: [{ id: 'amber', label: 'Amber' }], pricing: { prompt_per_mchar: 15, completion_per_mtok: 0 } },
  { id: 'google/gemini-tts', name: 'Gemini TTS', pcm: true, voices: [{ id: 'sage', label: 'Sage' }], pricing: { prompt_per_mchar: 1, completion_per_mtok: 0 } },
];

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test.describe('Audiobook', () => {
  test('the modal advertises and estimates, the reviewed start carries progress to download', async ({ page }) => {
    // The chosen narrator rides in via settings
    await page.addInitScript(() => {
      localStorage.setItem('im-settings', JSON.stringify({ narrationModel: 'or/voice-1', narrationVoice: 'amber' }));
    });

    await page.route('**/api/speech-models', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: SPEECH_MODELS }) });
    });

    // The reading itself is mocked at the network layer: null before the
    // slide, then page 1 of 2 twice, then ready.
    let started = false;
    let gets = 0;
    await page.route('**/api/stories/*/audiobook', async (route, request) => {
      if (request.method() === 'POST') {
        started = true;
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ audiobook: { story_id: 's1', status: 'pending', pages_done: 0, pages_total: 2, queue_position: 0 } }),
        });
      }
      if (!started) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ audiobook: null }) });
      gets++;
      if (gets <= 2) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ audiobook: { story_id: 's1', status: 'pending', pages_done: 1, pages_total: 2, queue_position: 0 } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          audiobook: { story_id: 's1', status: 'ready', pages_done: 2, pages_total: 2, duration_s: 300, cost_usd: 0.05, stale: false, updated_at: '2026-08-30 10:00:00' },
        }),
      });
    });

    const story = await createStoryViaUi(page, 'Audiobook Test');
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'First prose page of the tale.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Second prose page of the tale.' });
    await page.reload(); // reload with pages
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2');

    // The modal: narrator advertised, honest estimates, plate-free page count
    await page.locator('#audiobookBtn').click();
    await expect(page.locator('#audiobookModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#audiobookModalBody')).toContainText('Narrator: Voice One · voice Amber');
    await expect(page.locator('#audiobookModalBody')).toContainText('2 pages');
    await expect(page.locator('#audiobookModalBody')).toContainText('$');

    // The explicit paid-review button opens the final shared review; cancel
    // keeps the modal and sends nothing, confirm starts the reading
    await expect(page.locator('#audiobookStartBtn')).toContainText('Create audiobook (≈$');
    await page.locator('#audiobookStartBtn').click();
    await expect(page.locator('.dialog-manager')).toBeVisible({ timeout: 5000 });
    await page.locator('.dialog-manager button', { hasText: 'Cancel' }).click();
    await expect(page.locator('.dialog-manager')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#audiobookModal')).toBeVisible(); // reopened with its facts
    await page.locator('#audiobookStartBtn').click();
    const review = page.locator('.dialog-manager');
    await expect(review).toBeVisible({ timeout: 5000 });
    await expect(review.locator('.dialog-manager__body')).toContainText('Voice One');
    await expect(review.locator('.dialog-manager__body')).toContainText('2 narratable pages');
    await review.locator('button', { hasText: /Create audiobook/ }).first().click();
    await expect(review).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#audiobookModal')).toBeHidden();
    await expect(page.locator('#audiobookBanner')).toBeVisible();
    await expect(page.locator('#audiobookBannerText')).toContainText('page 0 of 2');

    // Progress carries, then the banner becomes a download (polls are mocked)
    await expect(page.locator('#audiobookBannerText')).toContainText('The audiobook is ready', { timeout: 10000 });
    const download = page.locator('#audiobookBannerActions a');
    await expect(download).toHaveText('Download');
    await expect(download).toHaveAttribute('href', new RegExp(`/stories/${story.id}/audiobook/audio$`));

    // Hide parks it: the Bookshelf owns the download afterwards
    await page.locator('#audiobookBannerActions button', { hasText: 'Hide' }).click();
    await expect(page.locator('#audiobookBanner')).toBeHidden();
  });

  test('the Bookshelf lists story art; deleting it keeps prose numbering', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    const title = `Bookshelf Test ${Date.now()}`;
    const story = await createStoryViaUi(page, title);
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'First prose page.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Second prose page.' });
    await apiPost(page, `/api/stories/${story.id}/pages/1/image-page`, {
      image: PNG_1PX, media_type: 'image/png', prompt: 'A candlelit hall.',
    });
    await page.reload();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2');

    await page.locator('#libraryBtn').click();
    await page.locator('#libraryBookshelfTab').click();
    await expect(page.locator('#librarySection')).toHaveClass(/active/);
    const entry = page.locator('.bookshelf-entry', { hasText: title });
    await expect(entry).toBeVisible({ timeout: 5000 });
    await expect(entry).toContainText('No audiobook kept'); // nothing read yet
    await expect(entry.locator('.bookshelf-plate')).toHaveCount(1);
    await expect
      .poll(() => entry.locator('.bookshelf-plate img').evaluate((el) => el.complete && el.naturalWidth > 0), { timeout: 5000 })
      .toBe(true);

    // Deleting art removes its placements but leaves the manuscript intact.
    await entry.locator('.bookshelf-plate button', { hasText: 'Delete' }).click();
    await expect(page.locator('.dialog-manager')).toBeVisible();
    await expect(page.locator('.dialog-manager__body')).toContainText('numbering stay unchanged');
    await page.locator('.dialog-manager button', { hasText: 'Delete art' }).click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 5000 });
    await expect(entry.locator('.bookshelf-plate')).toHaveCount(0);
    await expect(entry).toContainText('No manuscript art kept');
  });
});
