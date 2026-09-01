import { test, expect } from '@playwright/test';
import { apiPost, apiPut, E2E_PASSWORD, openUnlocked } from '../auth.js';

// The first paid action opens the shared review; remembered device consent
// deliberately bypasses it for later actions.
async function confirmPaidReview(page, label) {
  const dialog = page.locator('.dialog-manager');
  const remembered = await page.evaluate(() => localStorage.getItem('im-paid-consent-v1') === '1');
  if (remembered) {
    await expect(dialog).toBeHidden();
    return;
  }
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await dialog.locator('button', { hasText: label }).first().click();
  await expect(dialog).toBeHidden({ timeout: 5000 });
}

// Helper: pick a <select> option whose label contains `text`, return its value.
async function selectByLabel(page, selector, text) {
  const option = page.locator(`${selector} option`, { hasText: text }).first();
  await option.waitFor({ state: 'attached', timeout: 5000 });
  const value = await option.getAttribute('value');
  await page.selectOption(selector, value);
  return value;
}

test.describe('Ink Morrow UI', () => {
  test.beforeEach(async ({ page }) => {
    await openUnlocked(page);
  });

  test('has the gothic header with scribe and working navigation', async ({ page }) => {
    await expect(page).toHaveTitle(/Ink Morrow/);
    await expect(page.locator('.main-header h1')).toHaveText('Ink Morrow');
    await expect(page.locator('.cat-scribe img')).toBeVisible();
    const scribeStatus = page.locator('#scribeStatus');
    await expect(scribeStatus).toContainText('The scribe');
    if (page.viewportSize().width <= 520) await expect(scribeStatus).toBeHidden();
    else await expect(scribeStatus).toBeVisible();

    // Cycle every destination (Library covers the Stories surface)
    for (const [btn, section] of [
      ['characters', 'charactersSection'],
      ['library', 'librarySection'],
      ['write', 'writeSection'],
      ['settings', 'settingsSection'],
      ['worlds', 'worldsSection'],
      ['home', 'homeSection'],
    ]) {
      await page.locator(`#${btn}Btn`).click();
      await expect(page.locator(`#${section}`)).toHaveClass(/active/);
      await expect(page.locator(`#${btn}Btn`)).toHaveAttribute('aria-current', 'page');
    }
  });

  test('Lock revokes the session and the password unlocks it again', async ({ page }) => {
    await page.locator('#lockBtn').click();
    await expect(page.locator('#authLoginForm')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.container')).toBeHidden();
    await page.request.get('/api/worlds').then((response) => expect(response.status()).toBe(401));

    await page.fill('#authPassword', E2E_PASSWORD);
    await page.locator('#authLoginForm button[type="submit"]').click();
    await expect(page.locator('.container')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#homeSection')).toHaveClass(/active/);
  });

  test('creates a world through the form', async ({ page }) => {
    await page.locator('#worldsBtn').click();
    if (await page.locator('#worldCreateWrap').isHidden()) await page.locator('#worldNewBtn').click();
    await page.fill('#worldName', 'Gothic Castle Realm');
    await page.fill('#worldDescription', 'A dark world of ancient castles');
    await page.fill('#worldGenre', 'Dark Fantasy');
    await page.fill('#worldSetting', 'Gothic Medieval');
    await page.locator('#worldForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/); // creating paints the scene by default

    await expect(page.locator('#worldName')).toHaveValue('');
    const card = page.locator('#worldsList .item-card', { hasText: 'Gothic Castle Realm' });
    await expect(card).toBeVisible({ timeout: 5000 });
  });

  test('creates a character bound to a world, then casts both into a story', async ({ page }) => {
    // World
    await page.locator('#worldsBtn').click();
    if (await page.locator('#worldCreateWrap').isHidden()) await page.locator('#worldNewBtn').click();
    await page.fill('#worldName', 'E2E Realm');
    await page.locator('#worldForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/);
    await expect(page.locator('#worldsList .item-card', { hasText: 'E2E Realm' }).first()).toBeVisible({ timeout: 5000 });

    // Character in that world (select by visible label, not by guessed value)
    await page.locator('#charactersBtn').click();
    if (await page.locator('#characterCreateWrap').isHidden()) await page.locator('#characterNewBtn').click();
    await page.fill('#characterName', 'Lady Seraphina');
    await page.fill('#characterDescription', 'A mysterious noblewoman');
    await selectByLabel(page, '#characterWorld', 'E2E Realm');
    await page.locator('#characterForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/);
    await expect(page.locator('#charactersList .item-card', { hasText: 'Lady Seraphina' }).first()).toBeVisible({ timeout: 5000 });

    // Free-roaming second character
    if (await page.locator('#characterCreateWrap').isHidden()) await page.locator('#characterNewBtn').click();
    await page.fill('#characterName', 'The Drifter');
    await page.locator('#characterForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/);
    await expect(page.locator('#charactersList .item-card', { hasText: 'The Drifter' }).first()).toBeVisible({ timeout: 5000 });

    // A third character lets the creation flow prove both non-lead tiers.
    if (await page.locator('#characterCreateWrap').isHidden()) await page.locator('#characterNewBtn').click();
    await page.fill('#characterName', 'The Witness');
    await page.locator('#characterNoImageBtn').click();
    await expect(page.locator('#charactersList .item-card', { hasText: 'The Witness' }).first()).toBeVisible({ timeout: 5000 });

    // Every card carries reference-image controls (e2e key is a dummy, so
    // the portrait itself fails; the UI must still show the state honestly)
    const drifterCard = page.locator('#charactersList .item-card', { hasText: 'The Drifter' }).first();
    // Regeneration lives in the More menu with its approximate cost
    await drifterCard.locator('.card-more summary').click();
    const regenerateItem = drifterCard.locator('.card-more__item', { hasText: 'Regenerate image' });
    await expect(regenerateItem).toBeVisible();
    const menuEscapesCardClip = await drifterCard.evaluate((card) => {
      const menu = card.querySelector('.card-more__menu');
      const cardBox = card.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      return menuBox.bottom > cardBox.bottom && getComputedStyle(card).overflow === 'visible';
    });
    expect(menuEscapesCardClip).toBe(true);
    await regenerateItem.click();
    await confirmPaidReview(page, /Repaint it/); // the repaint uses the same remembered consent gate
    await expect(drifterCard.locator('.card-image--pending, .card-image--failed')).toBeVisible({ timeout: 8000 });

    // Story with tone + tiered cast: Seraphina is the Main Character, Drifter supports with a relation
    await page.locator('#writeBtn').click();
    await page.locator('#storyNewBtn').click();
    await expect(page.locator('#manuscriptStartSheet')).toBeVisible();
    await page.fill('#manuscriptStartName', 'The Shadow and the Flame');
    await page.fill('#startManualOpening', 'The shadow met the flame at midnight.');
    await page.locator('[data-start-stage="1"] [data-start-next="2"]').click();
    await selectByLabel(page, '#startWorld', 'E2E Realm');
    await page.locator('#castModeCentered').click(); // explicit centered choice reveals the lead picker
    await selectByLabel(page, '#mcSelect', 'Lady Seraphina');
    await selectByLabel(page, '#castCharSelect', 'The Drifter');
    await page.selectOption('#castTierSelect', 'supporting');
    await page.fill('#castRelation', 'a debt of silence between them');

    // Force the same passive catalogue reload that portrait polling performs.
    // The in-progress add row must not be cleared before the user can press Add.
    await page.locator('#charactersBtn').click();
    await expect(page.locator('#charactersSection')).toHaveClass(/active/);
    await page.locator('#writeBtn').click();
    await page.locator('#storyNewBtn').click();
    await expect(page.locator('#manuscriptStartSheet')).toBeVisible();
    await expect(page.locator('#castCharSelect')).toHaveValue(/.+/);
    await expect(page.locator('#castTierSelect')).toHaveValue('supporting');
    await expect(page.locator('#castRelation')).toHaveValue('a debt of silence between them');
    await page.locator('#castAddBtn').click();
    const leadRow = page.locator('#castList .cast-list__row--mc');
    await expect(leadRow).toContainText('Lady Seraphina');
    await expect(leadRow.locator('.cast-list__role')).toHaveText('Lead');
    const supportingRow = page.locator('#castList .cast-list__row', { hasText: 'The Drifter' });
    await expect(supportingRow.locator('.cast-list__role')).toHaveText('Supporting');

    await selectByLabel(page, '#castCharSelect', 'The Witness');
    await page.selectOption('#castTierSelect', 'background');
    await page.fill('#castRelation', 'saw what happened from the alley');
    await page.locator('#castAddBtn').click();
    const backgroundRow = page.locator('#castList .cast-list__row', { hasText: 'The Witness' });
    await expect(backgroundRow.locator('.cast-list__role')).toHaveText('Background');
    await page.locator('[data-start-stage="2"] [data-start-next="3"]').click();
    await page.selectOption('#manuscriptStartTone', 'romantic');
    await page.locator('#manuscriptStartSubmit').click();

    // Creating a story jumps to the write section with the story selected
    await expect(page.locator('#writeSection')).toHaveClass(/active/);
    await expect(page.locator('#shellManuscriptSelect option', { hasText: 'The Shadow and the Flame' })).toBeAttached({ timeout: 5000 });

    // Browser state is not enough: the backend must hold both roles and notes.
    const stories = (await (await page.request.get('/api/stories')).json()).stories;
    const saved = stories.find((story) => story.title === 'The Shadow and the Flame');
    expect(saved).toBeTruthy();
    expect(saved.tone).toBe('romantic');
    const full = (await (await page.request.get(`/api/stories/${saved.id}`)).json()).story;
    const characters = (await (await page.request.get('/api/characters')).json()).characters;
    const idFor = (name) => characters.find((character) => character.name === name).id;
    expect(full.characters.find((entry) => entry.id === idFor('The Drifter'))).toMatchObject({
      role: 'supporting',
      relation: 'a debt of silence between them',
    });
    expect(full.characters.find((entry) => entry.id === idFor('The Witness'))).toMatchObject({
      role: 'background',
      relation: 'saw what happened from the alley',
    });
  });

  test('blocks world deletion while referenced (409 surfaces as error)', async ({ page }) => {
    await page.locator('#worldsBtn').click();
    if (await page.locator('#worldCreateWrap').isHidden()) await page.locator('#worldNewBtn').click();
    await page.fill('#worldName', 'Busy Realm');
    await page.locator('#worldForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/);
    const card = page.locator('#worldsList .item-card', { hasText: 'Busy Realm' });
    await expect(card).toBeVisible({ timeout: 5000 });

    await page.locator('#charactersBtn').click();
    if (await page.locator('#characterCreateWrap').isHidden()) await page.locator('#characterNewBtn').click();
    await page.fill('#characterName', 'Busy Body');
    await selectByLabel(page, '#characterWorld', 'Busy Realm');
    await page.locator('#characterForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/);
    await expect(page.locator('#charactersList .item-card', { hasText: 'Busy Body' })).toBeVisible({ timeout: 5000 });

    // Deleting the in-use world: confirm the shared destructive dialog, then
    // the 409 error surfaces with the reason.
    await page.locator('#worldsBtn').click();
    await card.locator('.card-more summary').click();
    await card.locator('.card-more__item--danger', { hasText: 'Delete' }).click();
    await expect(page.locator('.dialog-manager')).toBeVisible();
    await page.locator('.dialog-manager button', { hasText: 'Delete world' }).click();
    await expect(page.locator('.error-message').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.error-message').first()).toContainText(/referenced/);
  });

  test('loads cleanly on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.locator('#charactersBtn').click();
    await expect(page.locator('#charactersSection')).toHaveClass(/active/);
    if (await page.locator('#characterCreateWrap').isHidden()) await page.locator('#characterNewBtn').click();
    await page.fill('#characterName', 'Mobile Character');
    await expect(page.locator('#characterName')).toHaveValue('Mobile Character');
  });

  test('the cast editor on the Stories page reshapes a running story\u2019s cast', async ({ page }) => {
    // Build a running tale with a two-member cast through the API
    const worldRes = await apiPost(page, '/api/worlds', { name: 'Cast Realm' });
    const world = (await worldRes.json()).world;
    const mk = async (name) =>
      (await (await apiPost(page, '/api/characters', { name, world_id: world.id })).json()).character;
    const lead = await mk('The Lead');
    const ally = await mk('The Ally');
    const supporter = await mk('The Supporter');
    const latecomer = await mk('The Latecomer');
    const storyRes = await apiPost(page, '/api/stories', {
      title: 'Cast Edit Test',
      world_id: world.id,
      characters: [
        { id: lead.id, role: 'mc', relation: null, state: { personality: 'Colder now, hungrier' } },
        { id: ally.id, role: 'supporting', relation: 'owes the Lead a life-debt', state: null },
      ],
    });
    const story = (await storyRes.json()).story;
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'The tale is already running.' });

    await openUnlocked(page);
    await page.locator('#libraryBtn').click();
    const card = page.locator('#storiesList .item-card', { hasText: 'Cast Edit Test' });
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('.card-cast').click();

    const modal = page.locator('#storyCastModal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    // Roster/details: the Lead is selected by default; the in-story sheet
    // shows as it stands; the base sheet is only a hint.
    await expect(modal.locator('#storyCastDetail h3')).toHaveText('The Lead');
    await expect(modal.locator('#storyCastDetail .cast-edit-member__sheet textarea').first()).toHaveValue('Colder now, hungrier');
    await expect(modal.locator('#storyCastMode')).toContainText('Centered on The Lead');

    // Edit the Lead's in-story appearance, then add both non-lead tiers to
    // the running cast through the real controls.
    const [, appearance] = await modal.locator('#storyCastDetail .cast-edit-member__sheet textarea').all();
    await appearance.fill('Cloak burned to rags');
    await modal.locator('#storyCastAddSelect').selectOption(supporter.id);
    await modal.locator('#storyCastAddRole').selectOption('supporting');
    await modal.locator('#storyCastAddRelation').fill('keeps the lantern lit');
    await modal.locator('#storyCastAddBtn').click();
    await expect(modal.locator('#storyCastDetail h3')).toHaveText('The Supporter');

    await modal.locator('#storyCastAddSelect').selectOption({ label: 'The Latecomer' });
    await modal.locator('#storyCastAddRole').selectOption('background');
    await modal.locator('#storyCastAddRelation').fill('a shadow at the edge of the tale');
    await modal.locator('#storyCastAddBtn').click();
    // The fresh member's sheet opens selected
    await expect(modal.locator('#storyCastDetail h3')).toHaveText('The Latecomer');

    await modal.locator('#storyCastSaveBtn').click();
    await expect(modal).toBeHidden({ timeout: 5000 });
    await expect(page.locator('.success-message').last()).toContainText('Cast Edit Test');

    // The server now holds the edited sheet and the new member, as-is
    const after = await (await page.request.get(`/api/stories/${story.id}`)).json();
    expect(after.story.characters.find((c) => c.id === lead.id).state).toEqual({
      personality: 'Colder now, hungrier',
      appearance: 'Cloak burned to rags',
    });
    expect(after.story.characters.find((c) => c.id === supporter.id)).toMatchObject({
      role: 'supporting',
      relation: 'keeps the lantern lit',
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
            {
              id: 'z-ai/glm-5.1',
              name: 'GLM 5.1',
              context_length: 128000,
              reasoning: true,
              reasoning_efforts: ['max', 'high', 'low'],
              reasoning_default: 'max',
              reasoning_mandatory: true,
              is_default: true,
              pricing: { prompt_per_mtok: 1.5, completion_per_mtok: 2 },
            },
            { id: 'a/other-model', name: 'Other Model', context_length: 64000, reasoning: false, pricing: { prompt_per_mtok: 10, completion_per_mtok: 30 } },
          ],
        },
      })
    );

    await page.locator('#settingsBtn').click();
    await expect(page.locator('#settingsSection')).toHaveClass(/active/);

    // The server default is a reasoning model, so its real effort ladder is
    // visible before the user explicitly chooses another model.
    await expect(page.locator('#reasoningBlock')).toBeVisible();
    await expect(page.locator('#reasoningSelect')).toHaveValue('max');
    await expect(page.locator('#reasoningSelect option')).toHaveCount(3);
    expect(await page.locator('#reasoningSelect option').evaluateAll((options) => options.map((option) => option.value)))
      .toEqual(['max', 'high', 'low']);

    // Search + per-model cost are visible
    await page.locator('.model-disclosure summary').click();
    await page.fill('#modelSearch', 'other');
    await expect(page.locator('#modelList .model-item')).toHaveCount(1);
    await expect(page.locator('#modelList .model-item')).toContainText('$10.00');

    // Selecting a model updates the label
    await page.locator('#modelList .model-item').click();
    await expect(page.locator('#currentModel')).toContainText('a/other-model');

    // Reasoning level appears only for a model that can think first.
    await expect(page.locator('#reasoningBlock')).toBeHidden();
    await page.fill('#modelSearch', 'glm');
    await page.locator('#modelList .model-item').click();
    await expect(page.locator('#reasoningBlock')).toBeVisible();
    await expect(page.locator('#reasoningSelect')).toHaveValue('max');
    await page.selectOption('#reasoningSelect', 'low');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('im-settings')).reasoningEffort)).toBe('low');

    // Scriptorium background toggle applies on the writing page
    await page.locator('#scriptoriumBgToggle').check();
    await page.locator('#writeBtn').click();
    await expect(page.locator('#writeSection')).toHaveClass(/scriptorium-bg/);

    // Cost ticker is visible by default
    await expect(page.locator('#costTicker')).toBeVisible();
    await expect(page.locator('#costTicker')).toContainText(/Session \$0\.0+ · Manuscript \$0\.0+/);

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
    await openUnlocked(page);

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
    if (await page.locator('#worldCreateWrap').isHidden()) await page.locator('#worldNewBtn').click();
    await page.fill('#worldName', 'Ashen');
    await page.locator('#worldAiBtn').click();
    await expect(page.locator('#aiDraftModal')).toBeVisible();

    // Choose short, generate
    await page.locator('#aiDraftBody .seg-btn', { hasText: 'Short' }).click();
    await page.locator('#aiDraftBody button', { hasText: 'Ask the scribe' }).click();
    await confirmPaidReview(page, /Draft it/); // drafting uses the same remembered consent gate

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
    const targetWorld = (await (await apiPost(page, '/api/worlds', {
      name: 'Character Edit Realm', generate_image: false,
    })).json()).world;
    await openUnlocked(page);
    await page.locator('#charactersBtn').click();
    if (await page.locator('#characterCreateWrap').isHidden()) await page.locator('#characterNewBtn').click();
    await page.fill('#characterName', 'Editable Soul');
    await page.locator('#characterNoImageBtn').click();
    const card = page.locator('#charactersList .item-card', { hasText: 'Editable Soul' });
    await expect(card).toBeVisible({ timeout: 5000 });

    await card.click(); // the card itself opens the editor
    await expect(page.locator('#characterEditorModal')).toBeVisible();
    await expect(page.locator('#charEditName')).toHaveValue('Editable Soul');
    await page.locator('#charEditWorld').selectOption(targetWorld.id);
    await page.fill('#charEditDescription', 'Rewritten by hand.');
    await page.fill('#charEditImagePrompt', 'A lone figure in ink.');
    const repaintRequests = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/characters\/[^/]+\/image(?:\?|$)/.test(request.url())) {
        repaintRequests.push(request.url());
      }
    });
    await page.locator('#charEditSaveBtn').click();
    await expect(page.locator('#characterEditorModal')).toBeHidden();
    await expect(card).toContainText('Rewritten by hand.');
    await expect(card).toContainText('World: Character Edit Realm');
    const characters = (await (await page.request.get('/api/characters')).json()).characters;
    expect(characters.find((character) => character.name === 'Editable Soul').world_id).toBe(targetWorld.id);
    expect(repaintRequests).toEqual([]);

    // The editor is plain fields only: exactly Save / Save & redo image / Cancel
    expect(await page.locator('#characterEditorModal button').count()).toBe(3);
  });

  test('edits a world lorebook through the editor', async ({ page }) => {
    await openUnlocked(page);
    await page.locator('#worldsBtn').click();
    if (await page.locator('#worldCreateWrap').isHidden()) await page.locator('#worldNewBtn').click();
    await page.fill('#worldName', 'Lorebook Realm');
    await page.locator('#worldForm .btn-primary').click();
    await confirmPaidReview(page, /Create & paint/);
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

    await openUnlocked(page);
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

  test('Library manages manuscripts and starts a provider-free opening', async ({ page }) => {
    // A story exists: Library is the catalogue and opens its per-story assets.
    const worldRes = await apiPost(page, '/api/worlds', { name: 'Disclosure Realm' });
    const world = (await worldRes.json()).world;
    await apiPost(page, '/api/stories', { title: 'A Tale That Exists', world_id: world.id, characters: [] });

    await page.locator('#libraryBtn').click();
    await expect(page.locator('#librarySection')).toHaveClass(/active/);
    // Retries share the job's in-memory server, so select the first matching
    // fixture if an earlier attempt already created the same title.
    const card = page.locator('#storiesList .item-card', { hasText: 'A Tale That Exists' }).first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText('0 KB media on disk');
    await expect(page.locator('#storyCreateWrap')).toHaveCount(0);

    await card.click();
    await expect(page.locator('#storyAssetsModal')).toBeVisible();
    await expect(page.locator('#storyAssetsTitle')).toHaveText('A Tale That Exists');
    await expect(page.locator('#storyAssetsBody')).toContainText('No cover is stored.');
    await expect(page.locator('#storyAssetsBody')).toContainText('Download EPUB');
    await page.locator('#storyAssetsCloseBtn').click();

    // The primary start flow stays in Library and the manual path makes no
    // provider or AI request before opening the editable Desk.
    await page.locator('#homeBtn').click();
    await expect(page.locator('#homeSection')).toHaveClass(/active/);
    const providerRequests = [];
    page.on('request', (request) => {
      if (/\/api\/(providers|ai\/)/.test(request.url())) providerRequests.push(request.url());
    });
    await page.locator('#heroStartBtn').click();
    await expect(page.locator('#manuscriptStartSheet')).toBeVisible();
    await page.fill('#manuscriptStartName', 'A Local Beginning');
    await page.fill('#startManualOpening', 'Rain whispered against the archive windows.');
    await page.locator('[data-start-stage="1"] [data-start-next="2"]').click();
    await page.locator('[data-start-stage="2"] [data-start-next="3"]').click();
    await page.locator('#manuscriptStartSubmit').click();
    await expect(page.locator('#writeSection')).toHaveClass(/active/);
    await expect(page.locator('#storyContent')).toContainText('Rain whispered against the archive windows.');
    expect(providerRequests).toEqual([]);
  });

  test('Desk edits, copyedits, returns, and restores a manuscript without provider work', async ({ page }) => {
    const storyRes = await apiPost(page, '/api/stories', { title: 'Desk Revision Proof', characters: [] });
    const story = (await storyRes.json()).story;
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'The first page.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'The middle page.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'The active tail.' });
    await page.goto(`/#/desk/${story.id}`);
    await expect(page.locator('#writeSection')).toHaveClass(/active/);
    await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 3');

    const providerRequests = [];
    page.on('request', (request) => {
      if (/\/api\/(ai|continuity)/.test(request.url())) providerRequests.push(request.url());
    });

    await page.locator('#deskPageEditBtn').click();
    await page.fill('#deskPageEditorText', 'The active tail, revised by its author.');
    await page.locator('#deskPageSaveNow').click();
    await expect(page.locator('#deskPageSaveState')).toContainText('Canonical revision saved');
    await expect(page.locator('#storyContent')).toContainText('revised by its author');

    await page.locator('#prevPageBtn').click();
    await page.locator('#prevPageBtn').click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 3');
    await expect(page.locator('#deskPageEditBtn')).toHaveText('Copyedit this page');
    await page.locator('#deskPageEditBtn').click();
    await page.fill('#deskPageEditorText', 'The first page, polished for display.');
    await page.locator('#deskPageSaveNow').click();
    await expect(page.locator('#deskPageSaveState')).toContainText('canon unchanged');
    expect(providerRequests).toEqual([]);

    await page.locator('#deskPageEditorClose').click();
    await page.locator('#deleteAfterBtn').click();
    const dialog = page.locator('.dialog-manager');
    await expect(dialog).toContainText('Pages 2');
    await expect(dialog).toContainText('2 pages');
    await dialog.locator('button', { hasText: 'Return and remove 2 later pages' }).click();
    await expect(page.locator('#deskRecoveryBanner')).toBeVisible();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 1');
    await page.locator('#deskRecoveryUndo').click();
    await expect(page.locator('#deskRecoveryBanner')).toBeHidden();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 3');
  });

  test('Chronicle pages the outline, maintains tail structure, and restores only a safe suffix', async ({ page }) => {
    const storyRes = await apiPost(page, '/api/stories', { title: 'Chronicle Proof', characters: [] });
    const story = (await storyRes.json()).story;
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Chronicle page one.\n\n***\n\nA scene turns.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Chronicle page two.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Chronicle page three.' });

    await page.goto(`/#/chronicle/${story.id}`);
    await expect(page.locator('#chronicleSection')).toHaveClass(/active/);
    await expect(page.locator('#chronicleStatus')).toContainText('3 narrative pages');
    await expect(page.locator('#chronicleOutline')).toContainText('Active tail');
    await expect(page.locator('#chronicleOutline .chronicle-page')).toHaveCount(3);

    await page.locator('#chronicleAddVolume').click();
    await page.locator('.dialog-manager input').fill('Volume II');
    await page.locator('.dialog-manager button', { hasText: 'Begin volume' }).click();
    await expect(page.locator('#chronicleOutline')).toContainText('Volume II - 1 chapter, 0 pages');
    await page.locator('#chronicleOutline button', { hasText: 'Remove empty volume' }).click();
    await page.locator('.dialog-manager button', { hasText: 'Remove empty volume' }).click();
    await expect(page.locator('#chronicleOutline')).not.toContainText('Volume II');

    await page.fill('#chroniclePageJump', '2');
    await page.locator('#chroniclePageJumpBtn').click();
    await page.locator('.chronicle-page__open', { hasText: 'Open page 2' }).click();
    await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 3');
    await page.locator('#prevPageBtn').click();
    await page.locator('#deleteAfterBtn').click();
    await page.locator('.dialog-manager button', { hasText: 'Return and remove 2 later pages' }).click();

    await page.locator('#chronicleBtn').click();
    await expect(page.locator('#chronicleRecoveries')).toContainText('Safe to restore');
    await page.locator('#chronicleRecoveries button', { hasText: 'Restore recovery' }).click();
    await page.locator('.dialog-manager button', { hasText: 'Restore 2 pages' }).click();
    await expect(page.locator('#chronicleStatus')).toContainText('3 narrative pages');
    await expect(page.locator('#chronicleRecoveries button', { hasText: 'Restore recovery' })).toBeDisabled();
  });

  test('Codex follows live world fields until the author makes a field manuscript-local', async ({ page }) => {
    const world = (await (await apiPost(page, '/api/worlds', {
      name: 'Frozen Coast', genre: 'Gothic', setting: 'Glass shore', description: 'The original coast.',
    })).json()).world;
    const character = (await (await apiPost(page, '/api/characters', {
      name: 'Mara', world_id: world.id, description: 'A patient cartographer.', personality: 'Patient',
    })).json()).character;
    const story = (await (await apiPost(page, '/api/stories', {
      title: 'Codex Proof', world_id: world.id,
      characters: [{ id: character.id, role: 'mc', relation: null, state: null }],
    })).json()).story;

    await apiPut(page, `/api/worlds/${world.id}`, {
      name: 'Changed Coast', genre: 'Gothic', setting: 'Basalt shore', description: 'The changed coast.',
    });
    await page.goto(`/#/codex/${story.id}`);
    await expect(page.locator('#codexSection')).toHaveClass(/active/);
    await expect(page.locator('#codexFoundations')).toContainText('Changed Coast');
    await expect(page.locator('#codexFoundations')).toContainText('Basalt shore');
    await expect(page.locator('#codexFoundations')).not.toContainText('Frozen Coast');
    await expect(page.locator('#codexTemplateUpdates')).toContainText('No Library fields differ');

    const settingCard = page.locator('#codexFoundations .codex-fact')
      .filter({ has: page.locator('h4', { hasText: 'Setting' }) });
    await settingCard.locator('.codex-fact__edit').click();
    await page.locator('.dialog-manager textarea').fill('Moonlit glass shore');
    await page.locator('.dialog-manager button', { hasText: 'Save foundation' }).click();
    await expect(page.locator('.success-message').last()).toContainText('Manuscript foundation updated');

    await apiPut(page, `/api/worlds/${world.id}`, {
      name: 'Storm Coast', genre: 'Gothic', setting: 'Obsidian harbor', description: 'The storm coast.',
    });
    await page.reload();
    await expect(page.locator('#codexFoundations')).toContainText('Storm Coast');
    await expect(page.locator('#codexFoundations')).toContainText('Moonlit glass shore');
    await expect(page.locator('#codexFoundations')).not.toContainText('Obsidian harbor');
    await expect(page.locator('#codexTemplateUpdates')).toContainText('Moonlit glass shore” → “Obsidian harbor');
    await expect(page.locator('#codexTemplateUpdates')).not.toContainText('Changed Coast” → “Storm Coast');
  });

  test('Gallery uploads, moves, and unplaces local art without provider or narrative work', async ({ page }) => {
    const story = (await (await apiPost(page, '/api/stories', {
      title: 'Gallery Proof', characters: [],
    })).json()).story;
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Gallery page one.' });
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Gallery page two.' });
    const providerRequests = [];
    page.on('request', (request) => {
      if (/\/(scene-image|image-prompt)|\/api\/ai\//.test(request.url())) providerRequests.push(request.url());
    });

    await page.goto(`/#/gallery/${story.id}`);
    await expect(page.locator('#gallerySection')).toHaveClass(/active/);
    await expect(page.locator('#galleryPaintBtn')).toBeVisible();
    await expect(page.locator('#galleryUploadBtn')).toBeVisible();
    await page.locator('#galleryUploadInput').setInputFiles({
      name: 'local-owner-art.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    });
    const dialog = page.locator('.dialog-manager');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="text"]').fill('Local owner art');
    await dialog.locator('select').selectOption({ label: 'Before first page' });
    await dialog.locator('button', { hasText: 'Upload image' }).click();

    const card = page.locator('.gallery-card', { hasText: 'Local owner art' });
    await expect(card).toBeVisible({ timeout: 8000 });
    await expect(card).toContainText('Source: uploaded locally');
    await expect(card).toContainText('needs alt text');
    expect(providerRequests).toEqual([]);

    await card.locator('.gallery-placement select').first().selectOption({ label: 'After page 2' });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/placements/') && response.request().method() === 'PATCH'),
      card.locator('button', { hasText: 'Move' }).click(),
    ]);
    await expect(page.locator('.success-message').first()).toContainText('Narrative page order');
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/placements/') && response.request().method() === 'DELETE'),
      card.locator('button', { hasText: 'Unplace' }).click(),
    ]);
    await expect(page.locator('.success-message').first()).toContainText('Gallery-only storage');

    const pages = (await (await page.request.get(`/api/stories/${story.id}/pages`)).json()).pages;
    const art = await (await page.request.get(`/api/stories/${story.id}/assets`)).json();
    expect(pages.map((item) => [item.page_number, item.content])).toEqual([
      [1, 'Gallery page one.'], [2, 'Gallery page two.'],
    ]);
    expect(art.assets).toHaveLength(1);
    expect(art.placements).toEqual([]);
    expect(providerRequests).toEqual([]);
  });

  test('Gate separates backup and builds EPUB plus PDF from one reviewed snapshot', async ({ page }) => {
    const story = (await (await apiPost(page, '/api/stories', {
      title: 'Gate Proof', characters: [],
    })).json()).story;
    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'Gate page one.\n\n***\n\nGate page two.' });
    const providerRequests = [];
    page.on('request', (request) => {
      if (/provider|models|completion|generate|scene-image|image-prompt/.test(request.url())) providerRequests.push(request.url());
    });

    await page.goto(`/#/gate/${story.id}`);
    await expect(page.locator('#gateSection')).toHaveClass(/active/);
    await expect(page.locator('.gate-card--backup')).toContainText('Full fidelity');
    await expect(page.locator('.gate-card--publication')).toContainText('Reading copy');
    await expect(page.locator('#gateCreateShareBtn')).toBeDisabled();
    await page.fill('#gatePublicationAuthor', 'E2E Author');
    await page.locator('#gatePublicationForm').evaluate((form) => form.requestSubmit());

    const dialog = page.locator('.dialog-manager');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('One immutable book');
    await expect(dialog).toContainText('Excluded: directions, continuity');
    await dialog.locator('button', { hasText: 'Build 2 formats' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#gateJobStatus')).toContainText('2 publication files ready', { timeout: 15000 });
    const downloads = page.locator('#gateJobDownloads a');
    await expect(downloads).toHaveCount(2);
    await expect(downloads.nth(0)).toContainText('EPUB');
    await expect(downloads.nth(1)).toContainText('PDF');
    const epub = await page.request.get(await downloads.nth(0).getAttribute('href'));
    const pdf = await page.request.get(await downloads.nth(1).getAttribute('href'));
    expect(epub.status()).toBe(200);
    expect(pdf.status()).toBe(200);
    expect((await epub.body()).subarray(0, 2).toString()).toBe('PK');
    expect((await pdf.body()).subarray(0, 8).toString()).toBe('%PDF-1.7');
    expect(providerRequests).toEqual([]);
  });

  test('shared reading copy stays frozen, isolated, and revocable', async ({ page, request }) => {
    const story = (await (await apiPost(page, '/api/stories', {
      title: 'Shared Lantern', characters: [],
    })).json()).story;
    await apiPost(page, `/api/stories/${story.id}/pages`, {
      content: 'The frozen public page.', user_input: 'PRIVATE-SHARE-CANARY',
    });
    const csrf = await page.evaluate(async () => (await (await fetch('/api/auth/status')).json()).csrf_token);

    await page.goto(`/#/gate/${story.id}`);
    await page.locator('#gatePublicationForm').evaluate((form) => form.requestSubmit());
    const dialog = page.locator('.dialog-manager');
    await expect(dialog).toBeVisible();
    await dialog.locator('button', { hasText: 'Back' }).click();
    await expect(page.locator('#gateCreateShareBtn')).toBeEnabled();
    await page.locator('#gateCreateShareBtn').click();
    const shareInput = page.locator('#gateShareUrl');
    await expect(shareInput).not.toHaveValue('');
    await expect(page.locator('#gateShareReveal')).toBeVisible();
    const shareUrl = await shareInput.inputValue();
    expect(shareUrl).toMatch(/^http:\/\/localhost:3100\/share\/#{1}[A-Za-z0-9_-]{43}$/);

    await apiPost(page, `/api/stories/${story.id}/pages`, { content: 'A later private live page.' });
    const publicRequests = [];
    page.on('request', (outgoing) => publicRequests.push(outgoing.url()));
    await page.goto(shareUrl);
    await expect(page.locator('#shareDocument')).toBeVisible();
    await expect(page.locator('#shareDocument')).toContainText('The frozen public page.');
    await expect(page.locator('#shareDocument')).not.toContainText('A later private live page.');
    await expect(page.locator('body')).not.toContainText('PRIVATE-SHARE-CANARY');
    expect(publicRequests.some((url) => /provider|models|completion|generate/.test(url))).toBe(false);
    expect(publicRequests.some((url) => url.includes('/api/public-share'))).toBe(true);
    expect(await request.get('/api/stories').then((response) => response.status())).toBe(401);

    const shareId = await page.request.get(`/api/publication-shares?story_id=${story.id}`)
      .then(async (response) => (await response.json()).shares[0].id);
    const revoked = await page.request.post(`/api/publication-shares/${shareId}/revoke`, {
      data: {}, headers: { 'X-InkMorrow-CSRF': csrf },
    });
    expect(revoked.status()).toBe(200);
    await page.reload();
    await expect(page.locator('#shareStatus')).toContainText('expired or been revoked');
    await expect(page.locator('#shareDocument')).toBeHidden();
  });

  test('long world descriptions clamp on the card; full text remains in the DOM', async ({ page }) => {
    const longDescription = 'A brass city under twin moons. '.repeat(60);
    await apiPost(page, '/api/worlds', { name: 'Longwinded Realm', description: longDescription, generate_image: false });
    await page.locator('#worldsBtn').click();
    const card = page.locator('#worldsList .item-card', { hasText: 'Longwinded Realm' });
    await expect(card).toBeVisible({ timeout: 5000 });

    // Bounded: the box clamps (scrollHeight exceeds the visible band)...
    const clamped = await card.locator('.item-card__desc').evaluate((el) => el.scrollHeight > el.clientHeight + 2);
    expect(clamped).toBe(true);
    // ...while the FULL text stays in the DOM for assistive tech and editors
    const inDom = await card.locator('.item-card__desc').evaluate((el) => el.textContent.includes('brass city under twin moons'));
    expect(inDom).toBe(true);
    const boxHeight = await card.locator('.item-card__desc').evaluate((el) => el.getBoundingClientRect().height);
    expect(boxHeight).toBeLessThan(160); // a bounded band, not a wall of prose
  });

  test('200% zoom and images-disabled modes stay usable', async ({ page }) => {
    await page.locator('#writeBtn').click();
    await expect(page.locator('#writeSection')).toHaveClass(/active/);

    // 200% zoom: no document-level horizontal overflow on desktop/tablet
    // widths (the phone stretch target in the viewport matrix promises no
    // overflow at 100% - halving a 390px viewport is beyond its reach).
    if (page.viewportSize()?.width >= 900) {
      await page.evaluate(() => { document.body.style.zoom = '2'; });
      const overflowAtZoom = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflowAtZoom).toBeLessThanOrEqual(2);
      await page.evaluate(() => { document.body.style.zoom = ''; });
    }

    // Images disabled: every control, field, and label remains present and
    // operable (the app never hides meaning inside artwork alone).
    await page.route('**/*.{png,jpg,jpeg,webp,svg}', (route) => route.abort());
    await page.route('**/api/*/image', (route) => route.abort());
    await page.reload();
    await page.locator('#writeBtn').click();
    await expect(page.locator('#writeSection')).toHaveClass(/active/);
    for (const sel of ['#shellManuscriptSelect', '#userInput', '#generateBtn', '#readAloudBtn', '#exportBtn']) {
      await expect(page.locator(sel)).toBeAttached();
    }
    await expect(page.locator('label[for="userInput"]')).toBeAttached(); // labels external to fields
    await page.locator('#worldsBtn').click();
    await expect(page.locator('#worldsSection')).toHaveClass(/active/);
    await expect(page.locator('#worldNewBtn')).toBeAttached();
  });
});
