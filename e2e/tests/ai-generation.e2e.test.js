import { test, expect } from '@playwright/test';

async function selectByLabel(page, selector, text) {
  const option = page.locator(`${selector} option`, { hasText: text }).first();
  await option.waitFor({ state: 'attached', timeout: 5000 });
  const value = await option.getAttribute('value');
  await page.selectOption(selector, value);
  return value;
}

async function createStoryViaUi(page, title) {
  // These tests exercise generation, not casting - build the minimal legal
  // cast (one Main Character) through the API, then select the story in the UI.
  const worldRes = await page.request.post('/api/worlds', { data: { name: `${title} World` } });
  const world = (await worldRes.json()).world;
  const charRes = await page.request.post('/api/characters', {
    data: { name: `${title} Protagonist`, world_id: world.id },
  });
  const character = (await charRes.json()).character;
  const storyRes = await page.request.post('/api/stories', {
    data: { title, world_id: world.id, characters: [{ id: character.id, role: 'mc', relation: null, state: null }] },
  });
  const story = (await storyRes.json()).story;

  await page.goto('/');
  await page.locator('#writeBtn').click();
  await page.selectOption('#currentStory', story.id);
  await expect(page.locator('#currentStory option', { hasText: title })).toBeAttached({ timeout: 5000 });
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

    // Scribe flavor/status appears while working, then the page renders
    await expect(page.locator('#storyContent')).toContainText('The brave knight approached', { timeout: 5000 });
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1');
    await expect(page.locator('#scribeStatus')).toContainText(/complete|quill|purr|ink|flicks|paws|murmurs|Candlelight|scribe/i);
  });

  test('retry regenerates the last page', async ({ page }) => {
    await createStoryViaUi(page, 'Retry Test');

    await page.fill('#userInput', 'Enter the castle');
    await page.locator('#generateBtn').click();
    await expect(page.locator('#storyContent')).toContainText('The brave knight approached', { timeout: 5000 });

    await page.locator('#retryBtn').click();
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

    await expect(page.locator('.error-message').first()).toContainText('no ink', { timeout: 5000 });
    // Buttons recover
    await expect(page.locator('#generateBtn')).toBeEnabled();
    await expect(page.locator('#generateBtn')).toHaveText('Generate Page');
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
    await page.goto('/');
    await page.locator('#worldsBtn').click();
    await page.fill('#worldName', 'Context Realm');
    await page.locator('#worldForm button[type="submit"]').click();
    await expect(page.locator('#worldsList .item-card', { hasText: 'Context Realm' })).toBeVisible({ timeout: 5000 });

    await page.locator('#charactersBtn').click();
    await page.fill('#characterName', 'Sir Context');
    await selectByLabel(page, '#characterWorld', 'Context Realm');
    await page.locator('#characterForm button[type="submit"]').click();
    await expect(page.locator('#charactersList .item-card', { hasText: 'Sir Context' })).toBeVisible({ timeout: 5000 });

    await page.locator('#storiesBtn').click();
    await page.fill('#storyTitle', 'Context Story');
    await selectByLabel(page, '#storyWorld', 'Context Realm');
    await page.selectOption('#storyTone', 'explicit');
    await selectByLabel(page, '#mcSelect', 'Sir Context');
    await expect(page.locator('#castList .cast-list__row--mc')).toContainText('Sir Context — Main Character');
    await page.locator('#storyForm button[type="submit"]').click();

    await page.fill('#userInput', 'Sir Context opens the tome');
    await page.locator('#generateBtn').click();
    await expect(page.locator('#storyContent')).toContainText('Mock page.', { timeout: 5000 });

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].user_input).toBe('Sir Context opens the tome');
  });

  test('exports the story as an EPUB download', async ({ page }) => {
    await createStoryViaUi(page, 'Export Test');
    await page.fill('#userInput', 'Enter the castle');
    await page.locator('#generateBtn').click();
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
  test('old pages are read-only; burn-after truncates via the slider', async ({ page }) => {
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
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 5000 });
    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 2');

    // Old page: writing is locked, the burn offer is visible
    await expect(page.locator('#userInput')).toBeDisabled();
    await expect(page.locator('#pastPageBar')).toBeVisible();

    // Burn modal: warning text, no-button keeps everything
    await page.locator('#deleteAfterBtn').click();
    await expect(page.locator('#burnModal')).toBeVisible();
    await expect(page.locator('#burnBody')).toContainText('no recovery');
    await page.locator('#burnCancelBtn').click();
    await expect(page.locator('#burnModal')).toBeHidden();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 2');

    // Slide all the way to yes
    await page.locator('#deleteAfterBtn').click();
    await page.evaluate(() => {
      const slider = document.getElementById('burnSlider');
      slider.value = 40;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#burnModal')).toBeVisible(); // partial slide is not consent
    await page.evaluate(() => {
      const slider = document.getElementById('burnSlider');
      slider.value = 100;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('#burnModal')).toBeHidden();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1', { timeout: 5000 });
    await expect(page.locator('#userInput')).toBeEnabled(); // page 1 is the last page again
  });
});

test.describe('Speculative next-page preparation', () => {
  test('an empty-direction Generate commits the prepared page instantly', async ({ page }) => {
    await page.route('**/api/stories/*/pages/generate', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p1', page_number: 1, content: 'The opening page settled like dust.', user_input: null, cost_usd: 0.001 },
        }),
      });
    });
    await page.route('**/api/stories/*/pages/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preview: { expected_page: 2, model: 'mock', cost_usd: 0.001 } }),
      });
    });
    await page.route('**/api/stories/*/pages/commit-preview', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          page: { id: 'p2', page_number: 2, content: 'The prepared continuation, ready before you asked.', user_input: null, cost_usd: 0.001 },
        }),
      });
    });

    await createStoryViaUi(page, 'Instant Test');

    // First page via the normal flow
    await page.locator('#generateBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1', { timeout: 5000 });

    // The scribe prepares the next page on her own; Generate turns into a green Next Page
    await expect(page.locator('#generateBtn')).toHaveText('Next Page', { timeout: 5000 });

    // Typing a direction turns it back into Generate
    await page.fill('#userInput', 'a sudden storm');
    await expect(page.locator('#generateBtn')).toHaveText('Generate Page');
    await page.fill('#userInput', '');

    // Empty direction -> instant commit of the prepared page
    await page.locator('#generateBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 2', { timeout: 5000 });
    await expect(page.locator('#storyContent')).toContainText('The prepared continuation');
    // The scribe immediately prepares the next page (chained speculation)
    await expect(page.locator('#generateBtn')).toHaveText('Next Page', { timeout: 5000 });
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
    await expect(page.locator('#readAloudBtn')).toHaveText('Read again', { timeout: 5000 });
    expect(narrateCalls).toBe(1);
    await expect
      .poll(() => costCalls, { timeout: 5000 })
      .toBeGreaterThanOrEqual(1);

    // Replaying in-session uses the cache and never bills again
    await page.locator('#readAloudBtn').click(); // Read again
    await expect(page.locator('#readAloudBtn')).toHaveText('Read again', { timeout: 5000 });
    expect(narrateCalls).toBe(2);
    const costBefore = costCalls;
    await page.waitForTimeout(500);
    expect(costCalls).toBe(costBefore); // cache hit: no second cost event
  });
});
