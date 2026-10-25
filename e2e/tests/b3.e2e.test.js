import { test, expect } from '@playwright/test';
import { openUnlocked, apiPost } from '../auth.js';
async function room(page, name) {
  await page
    .locator('#workspaceRooms')
    .getByRole('link', { name, exact: true })
    .click();
}
async function story(page) {
  const response = await apiPost(page, '/api/fiction', {
    scenario_id: 'drowned-bell',
    title: 'B3 creative test ' + Date.now(),
  });
  expect(response.status()).toBe(201);
  const { story } = await response.json();
  await page.goto(`/#/story/${story.id}`);
  await expect(page.locator('#fictionStoryTitle')).toHaveText(story.title);
  return story;
}
test.describe('B3 creative depth', () => {
  test.beforeEach(async ({ page }) => openUnlocked(page));
  test('creative settings and world bindings persist as future-only local revisions', async ({
    page,
  }, testInfo) => {
    const original = await story(page);
    let paid = 0;
    await page.route('**/api/fiction/*/replies', async (route) => {
      paid++;
      await route.abort();
    });
    await room(page, 'Codex');
    await page
      .getByRole('button', { name: 'Story preferences', exact: true })
      .click();
    await page
      .getByLabel('Narrative perspective', { exact: true })
      .selectOption('close-third');
    await page
      .getByLabel('Close-third focal character', { exact: true })
      .selectOption('iona');
    await page
      .getByLabel('Passage length target', { exact: true })
      .selectOption('extended');
    await page
      .getByRole('dialog')
      .getByLabel('Pacing', { exact: true })
      .selectOption('reflective');
    await page
      .getByLabel('Tone and atmosphere', { exact: true })
      .fill('Intimate, patient and attentive to small gestures.');
    await page
      .getByLabel('Include a next-scene proposal', { exact: true })
      .check();
    await page
      .getByLabel('Proposed location', { exact: true })
      .fill('A lamp-lit kitchen');
    const viewport=page.viewportSize();await page.setViewportSize({...viewport,height:440});
    await expect(page.getByRole('dialog').getByRole('button',{name:'Save preferences',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.setViewportSize(viewport);await page.locator('.dialog-manager__panel--studio').evaluate(panel=>{panel.scrollTop=0;});
    await page.screenshot({
      path: testInfo.outputPath('creative-studio.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Save preferences', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page
      .getByRole('button', { name: 'Edit story-local world', exact: true })
      .click();
    await page
      .getByLabel('Setting', { exact: true })
      .fill('A harbour that remembers the tide.');
    await page.getByLabel('Adopt Setting', { exact: true }).check();
    await page
      .getByText('Recorded facts take precedence over references', {
        exact: true,
      })
      .click();
    await page
      .getByLabel(/Keep in narration context.*Vale is the buyer/)
      .check();
    await page
      .getByLabel('Keep the reviewed recorded facts authoritative', {
        exact: true,
      })
      .check();
    await page
      .getByRole('button', { name: 'Apply selected fields', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const saved = await page.request.get(
      `/api/fiction/${original.id}/creative`,
    );
    const data = await saved.json();
    expect(data.settings.length.target).toBe(800);
    expect(data.settings.pacing).toBe('reflective');
    expect(data.reference_bindings['world:']).toContain('chart-sale');
    expect(data.settings.scene_plan.location).toBe('A lamp-lit kitchen');
    const publicStory = (
      await (await page.request.get(`/api/fiction/${original.id}`)).json()
    ).story;
    expect(publicStory.state.facts).toEqual(original.state.facts);
    expect(JSON.stringify(publicStory)).not.toContain('A lamp-lit kitchen');
    expect(paid).toBe(0);
    await page.reload();
    await room(page, 'Codex');
    await page
      .getByRole('button', { name: 'Story preferences', exact: true })
      .click();
    await expect(
      page.getByLabel('Length target (50–2,000)', { exact: true }),
    ).toHaveValue('800');
    await expect(
      page.getByLabel('Proposed location', { exact: true }),
    ).toHaveValue('A lamp-lit kitchen');
  });
  test('campaign declarations, vignette endings and immediate undo make no paid request', async ({
    page,
  }, testInfo) => {
    const original = await story(page);
    await room(page, 'Codex');
    await page
      .getByRole('button', { name: 'Campaign records', exact: true })
      .click();
    await page
      .getByLabel('Campaign section', { exact: true })
      .selectOption('quests');
    await page
      .getByLabel('Recorded description', { exact: true })
      .fill('Iona sets aside the search for the silver compass.');
    await page
      .getByLabel('Whose record?', { exact: true })
      .selectOption('iona');
    await page
      .getByLabel('Record status', { exact: true })
      .selectOption('resolved');
    await page
      .getByLabel('How did the goal end?', { exact: true })
      .selectOption('abandoned');
    await page
      .getByLabel('Why declare or correct this record?', { exact: true })
      .fill('An explicit owner decision; no achievement is claimed.');
    await page.screenshot({
      path: testInfo.outputPath('campaign-ledger.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Declare record', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#fictionFacts')).toContainText(
      'Resolution: abandoned',
    );
    await room(page, 'Chronicle');
    await page.locator('#fictionEndEpisode').click();
    await page
      .getByLabel('How does this episode end?', { exact: true })
      .selectOption('vignette');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'End episode', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#fictionUndoEpisode')).toBeVisible();
    await page.locator('#fictionUndoEpisode').click();
    await expect(page.locator('#fictionEndEpisode')).toBeVisible();
    const current = (
      await (await page.request.get(`/api/fiction/${original.id}`)).json()
    ).story;
    expect(current.state.episode.status).toBe('active');
    expect(current.state.episode.payoff_beat_id).toBeNull();
    expect(current.spend.known_usd).toBe(0);
  });
  test('a reusable template comparison adopts selected fields and preserves template and truth', async ({
    page,
  }) => {
    const created = await apiPost(page, '/api/fiction/catalog', {
      kind: 'character',
      entry: {
        name: 'Mara reference ' + Date.now(),
        description: 'A cautious mapmaker.',
        data: {
          motive: 'Protect Iona without controlling her.',
          background: 'A new proposal, not an established event.',
        },
      },
    });
    expect(created.status()).toBe(201);
    const template = (await created.json()).entry;
    const original = await story(page);
    await room(page, 'Codex');
    await page
      .locator('#fictionCast')
      .getByRole('button', { name: 'Edit story-local reference', exact: true })
      .first()
      .click();
    await page
      .getByLabel('Reusable template', { exact: true })
      .selectOption(template.id);
    await expect(
      page.getByRole('button', {
        name: 'Use selected candidate fields',
        exact: true,
      }),
    ).toBeVisible();
    for (const checkbox of await page
      .getByRole('dialog')
      .locator('.fiction-field-comparison input[type=checkbox]')
      .all())
      await checkbox.uncheck();
    await page.getByLabel('Use motive', { exact: true }).check();
    await page
      .getByRole('button', {
        name: 'Use selected candidate fields',
        exact: true,
      })
      .click();
    await page
      .getByLabel('Keep the reviewed recorded facts authoritative', {
        exact: true,
      })
      .check();
    await page
      .getByRole('button', { name: 'Apply selected fields', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const data = await (
      await page.request.get(`/api/fiction/${original.id}/creative`)
    ).json();
    expect(data.references.characters[0].value.data.motive).toBe(
      template.data.motive,
    );
    expect(data.references.characters[0].value.description).toBe(
      original.state.cast[0].description,
    );
    expect(
      (
        await (
          await page.request.get(`/api/fiction/catalog/${template.id}`)
        ).json()
      ).entry.revision,
    ).toBe(template.revision);
  });
});
