import { test, expect } from '@playwright/test';

// Helper: pick a <select> option whose label contains `text`, return its value.
async function selectByLabel(page, selector, text) {
  const option = page.locator(`${selector} option`, { hasText: text }).first();
  await option.waitFor({ state: 'attached', timeout: 5000 });
  const value = await option.getAttribute('value');
  await page.selectOption(selector, value);
  return value;
}

test.describe('ScribeTribe UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.container');
  });

  test('has the gothic header with scribe and working navigation', async ({ page }) => {
    await expect(page).toHaveTitle(/ScribeTribe/);
    await expect(page.locator('.main-header h1')).toHaveText('ScribeTribe');
    await expect(page.locator('.cat-scribe svg')).toBeVisible();
    await expect(page.locator('#scribeStatus')).toBeVisible();

    // Age gate appears on first visit and dismisses
    const gate = page.locator('#ageGate');
    if (await gate.isVisible()) {
      await page.locator('#ageGateAccept').click();
      await expect(gate).toBeHidden();
    }

    // Cycle every section
    for (const section of ['characters', 'stories', 'write', 'settings', 'worlds']) {
      await page.locator(`#${section}Btn`).click();
      await expect(page.locator(`#${section}Section`)).toHaveClass(/active/);
    }
  });

  test('creates a world through the form', async ({ page }) => {
    await page.locator('#worldsBtn').click();
    await page.fill('#worldName', 'Gothic Castle Realm');
    await page.fill('#worldDescription', 'A dark world of ancient castles');
    await page.fill('#worldGenre', 'Dark Fantasy');
    await page.fill('#worldSetting', 'Gothic Medieval');
    await page.locator('#worldForm button[type="submit"]').click();

    await expect(page.locator('#worldName')).toHaveValue('');
    const card = page.locator('#worldsList .item-card', { hasText: 'Gothic Castle Realm' });
    await expect(card).toBeVisible({ timeout: 5000 });
  });

  test('creates a character bound to a world, then casts both into a story', async ({ page }) => {
    // World
    await page.locator('#worldsBtn').click();
    await page.fill('#worldName', 'E2E Realm');
    await page.locator('#worldForm button[type="submit"]').click();
    await expect(page.locator('#worldsList .item-card', { hasText: 'E2E Realm' })).toBeVisible({ timeout: 5000 });

    // Character in that world (select by visible label, not by guessed value)
    await page.locator('#charactersBtn').click();
    await page.fill('#characterName', 'Lady Seraphina');
    await page.fill('#characterDescription', 'A mysterious noblewoman');
    await selectByLabel(page, '#characterWorld', 'E2E Realm');
    await page.locator('#characterForm button[type="submit"]').click();
    await expect(page.locator('#charactersList .item-card', { hasText: 'Lady Seraphina' })).toBeVisible({ timeout: 5000 });

    // Free-roaming second character
    await page.fill('#characterName', 'The Drifter');
    await page.locator('#characterForm button[type="submit"]').click();
    await expect(page.locator('#charactersList .item-card', { hasText: 'The Drifter' })).toBeVisible({ timeout: 5000 });

    // Every card carries reference-image controls (e2e key is a dummy, so
    // the portrait itself fails; the UI must still show the state honestly)
    const drifterCard = page.locator('#charactersList .item-card', { hasText: 'The Drifter' });
    await expect(drifterCard.locator('.card-image-redo')).toBeVisible({ timeout: 5000 });
    await drifterCard.locator('.card-image-redo').click();
    await expect(drifterCard.locator('.card-image--pending, .card-image--failed')).toBeVisible({ timeout: 8000 });

    // Story with tone + tiered cast: Seraphina is the Main Character, Drifter supports with a relation
    await page.locator('#storiesBtn').click();
    await page.fill('#storyTitle', 'The Shadow and the Flame');
    await selectByLabel(page, '#storyWorld', 'E2E Realm');
    await page.selectOption('#storyTone', 'romantic');
    await selectByLabel(page, '#mcSelect', 'Lady Seraphina');
    await selectByLabel(page, '#castCharSelect', 'The Drifter');
    await page.fill('#castRelation', 'a debt of silence between them');
    await page.locator('#castAddBtn').click();
    await expect(page.locator('#castList .cast-list__row--mc')).toContainText('Lady Seraphina — Main Character');
    await page.locator('#storyForm button[type="submit"]').click();

    // Creating a story jumps to the write section with the story selected
    await expect(page.locator('#writeSection')).toHaveClass(/active/);
    await expect(page.locator('#currentStory option', { hasText: 'The Shadow and the Flame' })).toBeAttached({ timeout: 5000 });
  });

  test('blocks world deletion while referenced (409 surfaces as error)', async ({ page }) => {
    await page.locator('#worldsBtn').click();
    await page.fill('#worldName', 'Busy Realm');
    await page.locator('#worldForm button[type="submit"]').click();
    const card = page.locator('#worldsList .item-card', { hasText: 'Busy Realm' });
    await expect(card).toBeVisible({ timeout: 5000 });

    await page.locator('#charactersBtn').click();
    await page.fill('#characterName', 'Busy Body');
    await selectByLabel(page, '#characterWorld', 'Busy Realm');
    await page.locator('#characterForm button[type="submit"]').click();
    await expect(page.locator('#charactersList .item-card', { hasText: 'Busy Body' })).toBeVisible({ timeout: 5000 });

    // Deleting the in-use world should surface the 409 error message
    page.on('dialog', (dialog) => dialog.accept());
    await page.locator('#worldsBtn').click();
    await card.locator('.card-delete').click();
    await expect(page.locator('.error-message').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error-message').first()).toContainText(/referenced/);
  });

  test('loads cleanly on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.locator('#charactersBtn').click();
    await expect(page.locator('#charactersSection')).toHaveClass(/active/);
    await page.fill('#characterName', 'Mobile Character');
    await expect(page.locator('#characterName')).toHaveValue('Mobile Character');
  });

  test('the cast editor on the Stories page reshapes a running story\u2019s cast', async ({ page }) => {
    // Build a running tale with a two-member cast through the API
    const worldRes = await page.request.post('/api/worlds', { data: { name: 'Cast Realm' } });
    const world = (await worldRes.json()).world;
    const mk = async (name) =>
      (await (await page.request.post('/api/characters', { data: { name, world_id: world.id } })).json()).character;
    const lead = await mk('The Lead');
    const ally = await mk('The Ally');
    const latecomer = await mk('The Latecomer');
    const storyRes = await page.request.post('/api/stories', {
      data: {
        title: 'Cast Edit Test',
        world_id: world.id,
        characters: [
          { id: lead.id, role: 'mc', relation: null, state: { personality: 'Colder now, hungrier' } },
          { id: ally.id, role: 'supporting', relation: 'owes the Lead a life-debt', state: null },
        ],
      },
    });
    const story = (await storyRes.json()).story;
    await page.request.post(`/api/stories/${story.id}/pages`, { data: { content: 'The tale is already running.' } });

    await page.goto('/');
    await page.locator('#storiesBtn').click();
    const card = page.locator('#storiesList .item-card', { hasText: 'Cast Edit Test' });
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('.card-cast').click();

    const modal = page.locator('#storyCastModal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // The in-story sheet shows as it stands; the base sheet is only a hint
    const leadBlock = modal.locator('.cast-edit-member', { hasText: 'The Lead' });
    await expect(leadBlock.locator('.cast-edit-member__sheet textarea').first()).toHaveValue('Colder now, hungrier');

    // Edit the Lead's in-story appearance, add the latecomer to the running cast
    const [, appearance] = await leadBlock.locator('.cast-edit-member__sheet textarea').all();
    await appearance.fill('Cloak burned to rags');
    await modal.locator('#storyCastAddSelect').selectOption({ label: 'The Latecomer' });
    await modal.locator('#storyCastAddRole').selectOption('background');
    await modal.locator('#storyCastAddRelation').fill('a shadow at the edge of the tale');
    await modal.locator('#storyCastAddBtn').click();
    await expect(modal.locator('.cast-edit-member', { hasText: 'The Latecomer' })).toBeVisible();

    await modal.locator('#storyCastSaveBtn').click();
    await expect(modal).toBeHidden({ timeout: 5000 });
    await expect(page.locator('.success-message').last()).toContainText('Cast Edit Test');

    // The server now holds the edited sheet and the new member, as-is
    const after = await (await page.request.get(`/api/stories/${story.id}`)).json();
    expect(after.story.characters.find((c) => c.id === lead.id).state).toEqual({
      personality: 'Colder now, hungrier',
      appearance: 'Cloak burned to rags',
    });
    expect(after.story.characters.find((c) => c.id === latecomer.id)).toMatchObject({
      role: 'background',
      relation: 'a shadow at the edge of the tale',
    });
  });

  test('settings: model picker with cost, scriptorium background, cost ticker', async ({ page }) => {
    await page.route('**/api/models', (route) =>
      route.fulfill({
        json: {
          models: [
            { id: 'z-ai/glm-5.1', name: 'GLM 5.1', context_length: 128000, reasoning: true, pricing: { prompt_per_mtok: 1.5, completion_per_mtok: 2 } },
            { id: 'a/other-model', name: 'Other Model', context_length: 64000, reasoning: false, pricing: { prompt_per_mtok: 10, completion_per_mtok: 30 } },
          ],
        },
      })
    );

    await page.locator('#settingsBtn').click();
    await expect(page.locator('#settingsSection')).toHaveClass(/active/);

    // Search + per-model cost are visible
    await page.fill('#modelSearch', 'other');
    await expect(page.locator('#modelList .model-item')).toHaveCount(1);
    await expect(page.locator('#modelList .model-item')).toContainText('$10.00');

    // Selecting a model updates the label
    await page.locator('#modelList .model-item').click();
    await expect(page.locator('#currentModel')).toContainText('a/other-model');

    // Reasoning level appears only for a model that can think first
    await expect(page.locator('#reasoningBlock')).toBeHidden();
    await page.fill('#modelSearch', 'glm');
    await page.locator('#modelList .model-item').click();
    await expect(page.locator('#reasoningBlock')).toBeVisible();
    await expect(page.locator('#reasoningSelect')).toHaveValue('medium');
    await page.selectOption('#reasoningSelect', 'high');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('st-settings')).reasoningEffort)).toBe('high');

    // Scriptorium background toggle applies on the writing page
    await page.locator('#scriptoriumBgToggle').check();
    await page.locator('#writeBtn').click();
    await expect(page.locator('#writeSection')).toHaveClass(/scriptorium-bg/);

    // Cost ticker is visible by default
    await expect(page.locator('#costTicker')).toBeVisible();
    await expect(page.locator('#costTicker')).toContainText(/Session \$0\.0+ · Story \$0\.0+/);

    // Story font selector changes the story window typeface
    const proseBefore = await page.evaluate(
      () => getComputedStyle(document.querySelector('.story-content p')).fontFamily
    );
    await page.locator('#settingsBtn').click();
    await page.locator('#fontList .font-item', { hasText: 'IBM Plex Mono' }).click();
    await page.locator('#writeBtn').click();
    const proseAfter = await page.evaluate(
      () => getComputedStyle(document.querySelector('.story-content p')).fontFamily
    );
    expect(proseBefore).not.toBe(proseAfter);
    expect(proseAfter).toContain('IBM Plex Mono');
  });

  test('AI draft: flesh out a world, edit, and save it', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.container');

    await page.route('**/api/ai/world', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          world: {
            name: 'The Ashen Marches',
            description: 'A drowned kingdom where the tide remembers names.',
            genre: 'Gothic fantasy',
            setting: 'Tidal ruins',
          },
          model: 'mock',
          cost_usd: 0.001,
        }),
      })
    );

    await page.locator('#worldsBtn').click();
    await page.fill('#worldName', 'Ashen');
    await page.locator('#worldAiBtn').click();
    await expect(page.locator('#aiDraftModal')).toBeVisible();

    // Choose short, generate
    await page.locator('#aiDraftBody .seg-btn', { hasText: 'Short' }).click();
    await page.locator('#aiDraftBody button', { hasText: 'Ask the scribe' }).click();

    // The draft arrives as editable fields; tweak the name
    const nameField = page.locator('#draft-name');
    await expect(nameField).toHaveValue('The Ashen Marches', { timeout: 5000 });
    await nameField.fill('The Ashen Marches, Revised');

    // Regenerate offers a new take before saving
    await expect(page.locator('#aiDraftBody button', { hasText: 'Regenerate — take 2' })).toBeVisible();

    await page.locator('#aiDraftBody button', { hasText: 'Save as World' }).click();
    await expect(page.locator('#aiDraftModal')).toBeHidden();
    await expect(page.locator('#worldsList .item-card', { hasText: 'The Ashen Marches, Revised' })).toBeVisible({ timeout: 5000 });
  });

  test('edits a character through the card editor, no AI assists involved', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.container');
    await page.locator('#charactersBtn').click();
    await page.fill('#characterName', 'Editable Soul');
    await page.locator('#characterForm button[type="submit"]').click();
    const card = page.locator('#charactersList .item-card', { hasText: 'Editable Soul' });
    await expect(card).toBeVisible({ timeout: 5000 });

    await card.click(); // the card itself opens the editor
    await expect(page.locator('#characterEditorModal')).toBeVisible();
    await expect(page.locator('#charEditName')).toHaveValue('Editable Soul');
    await page.fill('#charEditDescription', 'Rewritten by hand.');
    await page.fill('#charEditImagePrompt', 'A lone figure in ink.');
    await page.locator('#charEditSaveBtn').click();
    await expect(page.locator('#characterEditorModal')).toBeHidden();
    await expect(card).toContainText('Rewritten by hand.');

    // The editor is plain fields only: exactly Save / Save & redo image / Cancel
    expect(await page.locator('#characterEditorModal button').count()).toBe(3);
  });

  test('edits a world lorebook through the editor', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.container');
    await page.locator('#worldsBtn').click();
    await page.fill('#worldName', 'Lorebook Realm');
    await page.locator('#worldForm button[type="submit"]').click();
    const card = page.locator('#worldsList .item-card', { hasText: 'Lorebook Realm' });
    await expect(card).toBeVisible({ timeout: 5000 });

    await card.click();
    await expect(page.locator('#worldEditorModal')).toBeVisible();
    await page.fill('#worldEditLore', 'The twin moons chase each other forever.');
    await page.locator('#worldEditSaveBtn').click();
    await expect(page.locator('#worldEditorModal')).toBeHidden();

    // The saved lore is still there when reopening the editor
    await card.click();
    await expect(page.locator('#worldEditLore')).toHaveValue('The twin moons chase each other forever.');
    await page.locator('#worldEditCancelBtn').click();
    await expect(page.locator('#worldEditorModal')).toBeHidden();
  });

  test('shows a persistent banner when storage runs low', async ({ page }) => {
    await page.route('**/api/disk', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ free_bytes: 700 * 1024 * 1024, total_bytes: 64 * 1024 ** 3 }),
      });
    });

    await page.goto('/');
    await page.waitForSelector('.container');
    const banner = page.locator('#diskBanner');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#diskBannerText')).toContainText('running low');
    await expect(page.locator('#diskBannerText')).toContainText('700 MB');

    // Persistent: it stays up across every section until space recovers
    for (const section of ['write', 'settings', 'worlds']) {
      await page.locator(`#${section}Btn`).click();
      await expect(banner).toBeVisible();
    }
  });
});
