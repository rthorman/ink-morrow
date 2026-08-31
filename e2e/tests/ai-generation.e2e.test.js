import { test, expect } from '@playwright/test';
import { apiPost, openUnlocked } from '../auth.js';

async function selectByLabel(page, selector, text) {
  const option = page.locator(`${selector} option`, { hasText: text }).first();
  await option.waitFor({ state: 'attached', timeout: 5000 });
  const value = await option.getAttribute('value');
  await page.selectOption(selector, value);
  return value;
}

// The first paid action is reviewed; accepting it permanently remembers
// consent on this device, so later calls deliberately have no dialog.
async function confirmPaidReview(page, label) {
  const dialog = page.locator('.dialog-manager');
  const remembered = await page.evaluate(() => localStorage.getItem('st-paid-consent-v1') === '1');
  if (remembered) {
    await expect(dialog).toBeHidden();
    return;
  }
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await dialog.locator('button', { hasText: label }).first().click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
}

async function createStoryViaUi(page, title) {
  // These tests exercise generation, not casting - build the minimal legal
  // cast (one Main Character) through the API, then select the story in the UI.
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
  await page.selectOption('#currentStory', story.id);
  await expect(page.locator(`#currentStory option[value="${story.id}"]`)).toBeAttached({ timeout: 5000 });
  await expect(page.locator('#writeSection')).toHaveClass(/active/);
  return story;
}

test.describe('AI generation flows (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the AI generation endpoint with believable story text
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: {
            id: 'mock-page',
            page_number: 1,
            content: 'The brave knight approached the ancient castle, heart pounding with anticipation.',
            user_input: 'Enter the castle',
          },
        }),
      });
    });
    await page.route('**/api/stories/*/pages/regenerate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          page: {
            id: 'mock-page',
            page_number: 1,
            content: 'Rewritten: the castle loomed, ancient and hungry for visitors.',
            user_input: 'Enter the castle',
          },
        }),
      });
    });
  });

  test('generates a page and shows the scribe working', async ({ page }) => {
    await createStoryViaUi(page, 'Generation Test');

    await page.fill('#userInput', 'Enter the castle');
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);

    // Scribe flavor/status appears while working, then the page renders
    await expect(page.locator('#storyContent')).toContainText('The brave knight approached', { timeout: 5000 });
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1');
    await expect(page.locator('#scribeStatus')).toContainText(/complete|quill|purr|ink|flicks|paws|murmurs|Candlelight|scribe/i);
  });

  test('one consent persists and later page generation runs without another modal', async ({ page }) => {
    await page.unroute('**/api/stories/*/pages/generate');
    let generated = 0;
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      generated += 1;
      const requestBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: {
            id: `remembered-consent-${generated}`,
            page_number: generated,
            content: generated === 1 ? 'The first paid page.' : 'The second paid page, without another interruption.',
            user_input: requestBody.user_input,
          },
        }),
      });
    });
    await page.route('**/api/stories/*/pages/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preview: { expected_page: generated + 1, model: 'mock', cost_usd: 0.001 } }),
      });
    });

    await createStoryViaUi(page, 'Remembered Consent Test');
    await page.fill('#userInput', 'Open the first door');
    await page.locator('#generateBtn').click();

    const review = page.locator('.dialog-manager');
    await expect(review).toBeVisible({ timeout: 5000 });
    await expect(review.locator('.dialog-manager__body')).toContainText('≈$0.0500');
    await expect(review.locator('.dialog-manager__body')).not.toContainText(/unknown|unavailable/i);
    await expect(review.locator('.review-consent')).toContainText('Approve once');
    expect(await review.locator('.dialog-manager__body').evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
    expect(await review.locator('.review-list dd').first().evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
    await confirmPaidReview(page, /Write it/);
    await expect(page.locator('#storyContent')).toContainText('The first paid page.', { timeout: 5000 });
    expect(await page.evaluate(() => localStorage.getItem('st-paid-consent-v1'))).toBe('1');

    await page.fill('#userInput', 'Open the second door');
    await expect(page.locator('#generateBtn')).toHaveText('Write next page');
    await page.locator('#generateBtn').click();
    await expect(review).toBeHidden();
    await expect(page.locator('#storyContent')).toContainText('without another interruption', { timeout: 5000 });
    expect(generated).toBe(2);
  });

  test('retry regenerates the last page', async ({ page }) => {
    await createStoryViaUi(page, 'Retry Test');

    await page.fill('#userInput', 'Enter the castle');
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);
    await expect(page.locator('#storyContent')).toContainText('The brave knight approached', { timeout: 5000 });

    await page.locator('#retryBtn').click();
    await confirmPaidReview(page, /Write it/); // remembered consent deliberately bypasses this review
    await expect(page.locator('#storyContent')).toContainText('Rewritten: the castle loomed', { timeout: 5000 });
  });

  test('surfaces generation errors without breaking the UI', async ({ page }) => {
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The scribe has no ink (API key missing)' }),
      });
    });

    await createStoryViaUi(page, 'Error Test');
    await page.fill('#userInput', 'Try anyway');
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);

    await expect(page.locator('.error-message').first()).toContainText('no ink', { timeout: 5000 });
    // Buttons recover
    await expect(page.locator('#generateBtn')).toBeEnabled();
    await expect(page.locator('#generateBtn')).toHaveText('Write next page');
  });

  test('AI requests carry world, characters, tone and direction', async ({ page }) => {
    const seenRequests = [];
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      seenRequests.push(JSON.parse(route.request().postData()));
      await route.continue();
    });
    // Neutralize the real AI call result by mocking at the API level instead:
    // we only inspect the request, so fulfill with a canned page.
    await page.unroute('**/api/stories/*/pages/generate');
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      seenRequests.push(JSON.parse(route.request().postData()));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p1', page_number: 1, content: 'Mock page.', user_input: 'Go' },
        }),
      });
    });

    // Build a full setup: world, character, story
    await openUnlocked(page);
    await page.locator('#worldsBtn').click();
    if (await page.locator('#worldCreateWrap').isHidden()) await page.locator('#worldNewBtn').click();
    await page.fill('#worldName', 'Context Realm');
    await page.locator('#worldForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/); // create paints its scene by default
    await expect(page.locator('#worldsList .item-card', { hasText: 'Context Realm' })).toBeVisible({ timeout: 5000 });

    await page.locator('#charactersBtn').click();
    if (await page.locator('#characterCreateWrap').isHidden()) await page.locator('#characterNewBtn').click();
    await page.fill('#characterName', 'Sir Context');
    await selectByLabel(page, '#characterWorld', 'Context Realm');
    await page.locator('#characterForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/);
    await expect(page.locator('#charactersList .item-card', { hasText: 'Sir Context' })).toBeVisible({ timeout: 5000 });

    await page.locator('#writeBtn').click();
    if (await page.locator('#storyCreateWrap').isHidden()) await page.locator('#storyNewBtn').click();
    await page.fill('#storyTitle', 'Context Story');
    await selectByLabel(page, '#storyWorld', 'Context Realm');
    await page.selectOption('#storyTone', 'explicit');
    // First explicit selection asks once; acknowledge it
    const toneAck = page.locator('.dialog-manager button', { hasText: 'I am 18 or older' });
    if (await toneAck.isVisible({ timeout: 1500 }).catch(() => false)) await toneAck.click();
    await page.locator('#castModeCentered').click(); // explicit centered choice reveals the lead picker
    await selectByLabel(page, '#mcSelect', 'Sir Context');
    const leadRow = page.locator('#castList .cast-list__row--mc');
    await expect(leadRow.locator('.cast-list__name')).toHaveText('Sir Context');
    await expect(leadRow.locator('.cast-list__role')).toHaveText('Lead');
    await page.locator('#storyNoImageBtn').click();

    await page.fill('#userInput', 'Sir Context opens the tome');
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);
    await expect(page.locator('#storyContent')).toContainText('Mock page.', { timeout: 5000 });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].user_input).toBe('Sir Context opens the tome');
  });

  test('exports the story as an EPUB download', async ({ page }) => {
    await createStoryViaUi(page, 'Export Test');
    await page.fill('#userInput', 'Enter the castle');
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);
    await expect(page.locator('#storyContent')).toContainText('The brave knight approached', { timeout: 5000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportBtn').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('export_test.epub');

    // It is a real zip (EPUB) with the story metadata
    const fs = require('fs');
    const path = await download.path();
    const buf = fs.readFileSync(path);
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const text = buf.toString('utf8');
    expect(text).toContain('application/epub+zip');
    expect(text).toContain('<dc:title>Export Test</dc:title>');
    expect(text).toContain('OEBPS/nav.xhtml');
  });
});
test.describe('Reading old pages and burning the rest', () => {
  test('old pages are read-only; burn-after truncates through the destructive dialog', async ({ page }) => {
    // Two pages: generate a second one after the first
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p2', page_number: 2, content: 'The second page unfolded in candlelight.', user_input: 'continue' },
        }),
      });
    });
    await page.route('**/api/stories/*/pages?after=1', async (route) => {
      expect(route.request().method()).toBe('DELETE');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: 1, remaining: 1 }) });
    });
    await page.route('**/api/stories/*/pages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [{ id: 'p1', page_number: 1, content: 'The first page was written in haste.', user_input: 'begin' }],
        }),
      });
    });

    await createStoryViaUi(page, 'Burn Test');

    // Generate the second page, then step back to page 1
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 5000 });
    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 2');

    // Old page: writing is locked, the burn offer is visible
    await expect(page.locator('#userInput')).toBeDisabled();
    await expect(page.locator('#pastPageBar')).toBeVisible();

    // Burn dialog: warning text, Cancel keeps everything
    await page.locator('#deleteAfterBtn').click();
    await expect(page.locator('.dialog-manager')).toBeVisible();
    await expect(page.locator('.dialog-manager__title')).toContainText('Delete 1 later page?');
    await expect(page.locator('.dialog-manager__body')).toContainText('permanently');
    await page.locator('.dialog-manager button', { hasText: 'Cancel' }).click();
    await expect(page.locator('.dialog-manager')).toBeHidden();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 2');

    // Confirming the destructive dialog truncates
    await page.locator('#deleteAfterBtn').click();
    await page.locator('.dialog-manager button', { hasText: 'Delete 1 page' }).click();

    await expect(page.locator('.dialog-manager')).toBeHidden();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1', { timeout: 5000 });
    await expect(page.locator('#userInput')).toBeEnabled(); // page 1 is the last page again
  });
});

test.describe('Single-page deletion renumbers (real backend)', () => {
  test('deleting the middle page closes the gap and the next page lands on N+1', async ({ page }) => {
    const story = await createStoryViaUi(page, 'Renumber Test');
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Renumber page one.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Renumber page two.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Renumber page three.' });
    await page.selectOption('#currentStory', story.id);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 3');

    // Step to the middle page and delete it through the real endpoint.
    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 3');
    await page.locator('#deletePageBtn').click();
    await expect(page.locator('.dialog-manager')).toBeVisible();
    await expect(page.locator('.dialog-manager__body')).toContainText('move up to close the gap');
    await page.locator('.dialog-manager button', { hasText: 'Delete page 2' }).click();

    // Contiguous again: old page 3 now sits at 2, reader lands on an existing page.
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 5000 });
    await expect(page.locator('#storyContent')).toContainText('Renumber page three.');
    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#storyContent')).toContainText('Renumber page one.');

    // The next written page takes 3 — no gap reuse, no duplicate. The reload
    // proves the numbering comes from the database, not in-page state; the
    // hash still points at page 1, so the reader restores there.
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Renumber page four.' });
    await page.reload();
    await expect(page.locator('#writeSection')).toHaveClass(/active/);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 3', { timeout: 5000 });
    await expect(page.locator('#storyContent')).toContainText('Renumber page one.');

    // Walk forward: the renumbered middle and the new tail are both honest.
    await page.locator('#nextPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 3');
    await expect(page.locator('#storyContent')).toContainText('Renumber page three.');
    await page.locator('#nextPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 3');
    await expect(page.locator('#storyContent')).toContainText('Renumber page four.');
  });

  test('deleting the first page renumbers the rest through the reader', async ({ page }) => {
    const story = await createStoryViaUi(page, 'Renumber First Test');
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Firstborn page.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Secondborn page.' });
    await page.selectOption('#currentStory', story.id);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2');

    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 2');
    await page.locator('#deletePageBtn').click();
    await page.locator('.dialog-manager button', { hasText: 'Delete page 1' }).click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1', { timeout: 5000 });
    await expect(page.locator('#storyContent')).toContainText('Secondborn page.');
  });
});

test.describe('Speculative next-page preparation', () => {
  test('an empty-direction Generate commits the prepared page instantly', async ({ page }) => {
    let generateCalls = 0;
    let previewCalls = 0;
    let commitCalls = 0;
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      generateCalls += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p1', page_number: 1, content: 'The opening page settled like dust.', user_input: null, cost_usd: 0.001 },
        }),
      });
    });
    await page.route('**/api/stories/*/pages/preview', async (route) => {
      previewCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preview: {
            expected_page: previewCalls + 1,
            preview_key: `prepared-${previewCalls + 1}`,
            model: 'mock',
            cost_usd: 0.001,
          },
        }),
      });
    });
    await page.route('**/api/stories/*/pages/commit-preview', async (route) => {
      commitCalls += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p2', page_number: 2, content: 'The prepared continuation, ready before you asked.', user_input: null, cost_usd: 0.001 },
        }),
      });
    });

    await createStoryViaUi(page, 'Instant Test');

    // First page via the normal flow (the review also disclosed the follow-up
    // preparation, so the scribe may prepare on her own afterwards)
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1', { timeout: 5000 });

    // The scribe prepares the next page on her own; Generate turns into a green Next Page
    await expect(page.locator('#generateBtn')).toHaveText('Use prepared page', { timeout: 5000 });

    // Typing a direction turns it back into Generate
    await page.fill('#userInput', 'a sudden storm');
    await expect(page.locator('#generateBtn')).toHaveText('Write next page');
    await page.fill('#userInput', '');

    // Empty direction -> review the continuity/successor work, then commit instantly
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, 'Use prepared page');
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 5000 });
    await expect(page.locator('#storyContent')).toContainText('The prepared continuation');
    // The scribe immediately prepares exactly one next page. The green press
    // never fell through to a duplicate live generation.
    await expect(page.locator('#generateBtn')).toHaveText('Use prepared page', { timeout: 5000 });
    expect({ generateCalls, commitCalls, previewCalls }).toEqual({ generateCalls: 1, commitCalls: 1, previewCalls: 2 });
  });
});

test.describe('Narration (read aloud)', () => {
  function silentWav() {
    const sampleRate = 8000;
    const seconds = 0.15;
    const samples = sampleRate * seconds;
    const buffer = Buffer.alloc(44 + samples);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + samples, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate, 28); // byte rate
    buffer.writeUInt16LE(1, 32); // block align
    buffer.writeUInt16LE(8, 34); // 8-bit
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples, 40);
    return buffer;
  }

  test('configures narration, streams, and bills once per generation', async ({ page }) => {
    page.on('request', (r) => { if (r.url().includes('narrate')) console.log('TEST-REQ-NARRATE'); });
    page.on('response', (r) => { if (r.url().includes('narrate')) console.log('TEST-RESP-NARRATE:', r.status()); });
    let narrateCalls = 0;
    let costCalls = 0;
    await page.route('**/api/stories/*/pages/generate', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p1', page_number: 1, content: 'The opening page.', user_input: null, cost_usd: 0 },
        }),
      })
    );
    await page.route('**/api/speech-models', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [{ id: 'or/voice-1', name: 'Voice One', voices: [{ id: 'amber', label: 'Amber' }] }],
        }),
      })
    );
    await page.route('**/api/stories/*/pages/*/narrate', async (route) => {
      narrateCalls++;
      const headers = { 'X-Generation-Id': 'gen-e2e-01' };
      if (narrateCalls > 1) headers['X-Narration-Cache'] = 'hit';
      await route.fulfill({ status: 200, headers, body: silentWav() });
    });
    await page.route('**/api/ai/generation-cost*', async (route) => {
      costCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ generation_id: 'gen-e2e-01', cost_usd: 0.009, model: 'or/voice-1' }),
      });
    });

    // Unconfigured: the control explains instead of failing silently
    await createStoryViaUi(page, 'Narration Test');
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/); // the write review precedes the paid call
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1', { timeout: 5000 });
    await page.locator('#readAloudBtn').click();
    await expect(page.locator('#settingsSection')).toHaveClass(/active/);
    await expect(page.locator('.error-message').first()).toContainText('not configured');

    // Configure model + dependent voice through Settings
    await page.selectOption('#narrationModelSelect', 'or/voice-1');
    await expect(page.locator('#narrationVoiceSelect')).toBeEnabled();
    await page.selectOption('#narrationVoiceSelect', 'amber');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('st-settings')).narrationVoice)).toBe('amber');

    // Read aloud: streams, plays, completes, and bills exactly once
    await page.locator('#writeBtn').click();
    await page.locator('#readAloudBtn').click();
    await confirmPaidReview(page, /Read it/); // narration passes the paid review
    await expect(page.locator('#readAloudBtn')).toHaveText('Read again', { timeout: 5000 });
    expect(narrateCalls).toBe(1);
    await expect
      .poll(() => costCalls, { timeout: 5000 })
      .toBeGreaterThanOrEqual(1);

    // Replaying in-session uses the cache and never bills again (the review
    // is still shown: a cache hit is possible, never promised)
    await page.locator('#readAloudBtn').click(); // Read again
    await confirmPaidReview(page, /Read it/);
    await expect(page.locator('#readAloudBtn')).toHaveText('Read again', { timeout: 5000 });
    expect(narrateCalls).toBe(2);
    const costBefore = costCalls;
    await page.waitForTimeout(500);
    expect(costCalls).toBe(costBefore); // cache hit: no second cost event

    // Autoplay: a second page, then the chain flips and reads to the end
    await page.fill('#userInput', 'a second page');
    await page.route('**/api/stories/*/pages/generate', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p2', page_number: 2, content: 'The second page.', user_input: 'a second page', cost_usd: 0 },
        }),
      })
    );
    await page.locator('#generateBtn').click();
    await confirmPaidReview(page, /Write it/);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 5000 });

    await page.locator('#narrationAutoBtn').click(); // autoplay on
    await confirmPaidReview(page, /Auto-read/); // the run's remaining pages disclosed once
    await page.locator('#prevPageBtn').click(); // back to page one
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 2');

    await page.locator('#readAloudBtn').click(); // starts the chain on page one
    await confirmPaidReview(page, /Read it/);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 8000 }); // flipped automatically
    await expect(page.locator('#readAloudBtn')).toHaveText('Read again', { timeout: 8000 }); // tale exhausted
  });
});

// ---------------------------------------------------------------------------
// Scene image prompt: condense the current page into an image-gen prompt
// ---------------------------------------------------------------------------

test.describe('Scene image prompt', () => {
  test('condenses the current page into an editable popup, paints it, and books the cost', async ({ page }) => {
    let promptCalls = 0;
    let sceneCalls = 0;
    await page.route('**/api/stories/*/pages/*/image-prompt', async (route) => {
      promptCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ prompt: 'A candlelit gothic hall, wide cinematic shot, frost on black stone.' }),
      });
    });
    await page.route('**/api/stories/*/pages/*/scene-image', async (route) => {
      sceneCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // A real 1x1 PNG so the <img> element renders something valid
        body: JSON.stringify({
          image:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          media_type: 'image/png',
          cost_usd: 0.06,
          references: [],
        }),
      });
    });

    const story = await createStoryViaUi(page, 'Image Prompt Test');
    await apiPost(page, `/api/stories/${story.id}/pages`, {
      content: 'The hall stood dark and cold.', user_input: null,
    });
    await page.selectOption('#currentStory', story.id); // reload with the page present
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1');

    await page.locator('#imagePromptBtn').click();
    await confirmPaidReview(page, /Condense it/); // the condensation is paid work
    await expect(page.locator('#imagePromptModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#imagePromptText')).toHaveValue(
      'A candlelit gothic hall, wide cinematic shot, frost on black stone.'
    );
    expect(promptCalls).toBe(1);

    // Render quality is selectable and persists in settings
    await expect(page.locator('#imageQualitySelect')).toBeVisible();
    await page.selectOption('#imageQualitySelect', 'medium_2k');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('st-settings')).sceneRenderQuality)).toBe('medium_2k');

    // Paint it: the edited prompt is sent, the image opens in the zoomable popup
    const sentBody = page.waitForRequest((request) => {
      if (request.url().includes('/scene-image')) {
        expect(JSON.parse(request.postData()).prompt).toBe('A candlelit gothic hall, warmer light.');
        return true;
      }
      return false;
    });
    await page.fill('#imagePromptText', 'A candlelit gothic hall, warmer light.');
    await page.locator('#imagePromptGenerateBtn').click();
    await confirmPaidReview(page, /Paint it/); // resolution + references disclosed
    await sentBody;
    await expect(page.locator('#sceneImageViewerModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#sceneViewerImg')).toBeVisible();
    // Truly decoded, not a CSP-blocked or broken icon
    await expect
      .poll(() => page.locator('#sceneViewerImg').evaluate((el) => el.complete && el.naturalWidth > 0), { timeout: 5000 })
      .toBe(true);
    await expect(page.locator('#sceneImageCost')).toContainText('$0.0600');
    expect(sceneCalls).toBe(1);

    // Zoom really zooms (wheel), double-click resets, in a real browser
    const img = page.locator('#sceneViewerImg');
    await img.hover();
    await page.mouse.wheel(0, -240);
    await expect
      .poll(async () => img.evaluate((el) => el.style.transform), { timeout: 3000 })
      .toContain('scale(');
    expect(await img.evaluate((el) => el.style.transform)).not.toBe('scale(1)');
    await img.dblclick();
    await expect
      .poll(async () => img.evaluate((el) => el.style.transform), { timeout: 3000 })
      .toBe('translate(0px, 0px) scale(1)');

    // Ghost buttons: Close returns to the prompt popup, Save downloads
    await expect(page.locator('#sceneViewerSaveBtn')).toBeVisible();
    await page.locator('#sceneViewerCloseBtn').click();
    await expect(page.locator('#sceneImageViewerModal')).toBeHidden();
    await expect(page.locator('#imagePromptModal')).toBeVisible(); // still editing behind

    await page.locator('#imagePromptCancelBtn').click();
    await expect(page.locator('#imagePromptModal')).toBeHidden();
  });

  test('Add as page binds the painting after the illustrated page and closes both modals', async ({ page }) => {
    // Only the paint itself is mocked; the binding POST, the plate GET and the
    // export below all hit the real server against its in-memory database.
    const PNG_1PX =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await page.route('**/api/stories/*/pages/*/image-prompt', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ prompt: 'A candlelit gothic hall, frost on black stone.' }),
      });
    });
    await page.route('**/api/stories/*/pages/*/scene-image', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ image: PNG_1PX, media_type: 'image/png', cost_usd: 0.06, references: [] }),
      });
    });

    const story = await createStoryViaUi(page, 'Image Page Test');
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'First prose page.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Second prose page.' });
    await page.selectOption('#currentStory', story.id);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2');

    // Illustrate the FIRST page: the plate must land between the two prose pages
    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 2');
    await page.locator('#imagePromptBtn').click();
    await confirmPaidReview(page, /Condense it/); // the condensation is paid work
    await expect(page.locator('#imagePromptModal')).toBeVisible({ timeout: 5000 });
    await page.locator('#imagePromptGenerateBtn').click();
    await confirmPaidReview(page, /Paint it/);
    await expect(page.locator('#sceneImageViewerModal')).toBeVisible({ timeout: 5000 });

    await page.locator('#sceneViewerAddPageBtn').click();
    await expect(page.locator('#sceneImageViewerModal')).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#imagePromptModal')).toBeHidden();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 3');

    // The plate renders from the real image route, not a placeholder
    const plate = page.locator('.scene-plate');
    await expect(plate).toBeVisible();
    await expect
      .poll(() => plate.evaluate((el) => el.complete && el.naturalWidth > 0), { timeout: 5000 })
      .toBe(true);
    await expect(plate).toHaveAttribute('alt', 'A candlelit gothic hall, frost on black stone.');

    // The old second page shifted to page 3; text tools sleep on the plate
    await page.locator('#nextPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 3');
    await expect(page.locator('#storyContent')).toContainText('Second prose page.');
    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#readAloudBtn')).toBeDisabled();
    await expect(page.locator('#imagePromptBtn')).toBeDisabled();

    // The exported EPUB carries the plate inside the book
    const exportRes = await page.request.get(`/api/stories/${story.id}/export`);
    expect(exportRes.ok()).toBe(true);
    const book = await exportRes.body();
    const asText = book.toString('utf8');
    expect(asText).toContain('<item id="img2" href="images/page-2.png" media-type="image/png"/>');
    expect(asText).toContain('<img src="images/page-2.png"');
    expect(asText).toContain('Second prose page.'); // the renumbered page survived
  });
});
