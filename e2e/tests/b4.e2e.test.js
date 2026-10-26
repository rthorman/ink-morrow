import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openUnlocked, apiPost, csrfToken, writerSessionId } from '../auth.js';
const fixture = readFileSync(
  path.join(__dirname, '../fixtures/editorial-story.inkmorrow5'),
);
async function start(page) {
  const response = await page.request.post('/api/fiction/saves/import', {
    headers: {
      'Content-Type': 'application/vnd.inkmorrow.fiction-save',
      'X-InkMorrow-CSRF': await csrfToken(page),
      'X-InkMorrow-Writer-Session': await writerSessionId(page),
    },
    data: fixture,
  });
  expect(response.status()).toBe(201);
  const { story } = await response.json();
  await page.goto(`/#/story/${story.id}/chronicle`);
  await expect(page.locator('#fictionStoryTitle')).toHaveText(story.title);
  await expect(page.locator('#workspaceEditorial')).toContainText(
    'Automatic episode-based',
  );
  return story;
}
async function organize(page) {
  await page
    .getByRole('button', { name: 'Organize chapters & volumes', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog')
      .getByLabel('Chapter title', { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(
    '5 passage choices loaded',
  );
}
test.describe('B4 editorial work', () => {
  test.beforeEach(async ({ page }) => openUnlocked(page));
  test('split chapters, assign volumes and preview a complete unchanged reading path', async ({
    page,
  }, testInfo) => {
    const story = await start(page);
    let paid = 0;
    await page.route('**/api/fiction/*/replies', async (route) => {
      paid++;
      await route.abort();
    });
    await organize(page);
    const first = page.locator('#editorialChapters > article').first();
    await first
      .getByLabel('Split after passage', { exact: true })
      .selectOption(
        story.beats.filter((beat) =>
          ['opening', 'scene'].includes(beat.kind),
        )[1].id,
      );
    await first
      .getByRole('button', { name: 'Split this chapter', exact: true })
      .click();
    await expect(page.locator('#editorialChapters > article')).toHaveCount(2);
    await page
      .locator('#editorialChapters > article')
      .nth(0)
      .getByLabel('Chapter title', { exact: true })
      .fill('At the garden gate');
    await page
      .locator('#editorialChapters > article')
      .nth(1)
      .getByLabel('Chapter title', { exact: true })
      .fill('Tea after the rain');
    await page
      .getByRole('button', { name: 'Start a new volume', exact: true })
      .click();
    await page
      .locator('#editorialVolumes > article')
      .nth(1)
      .getByLabel('Volume title', { exact: true })
      .fill('The afternoon');
    await page
      .locator('#editorialChapters > article')
      .nth(1)
      .getByLabel('In volume', { exact: true })
      .selectOption({ label: 'The afternoon' });
    await page
      .getByRole('button', { name: 'Preview chapter layout', exact: true })
      .click();
    await expect(page.locator('#editorialPreview')).toContainText(
      'passages 1–2',
    );
    await expect(page.locator('#editorialPreview')).toContainText(
      'passages 3–5',
    );
    await expect(page.locator('#editorialPreview')).toContainText('empty plan');
    const viewport = page.viewportSize();
    await page.setViewportSize({ ...viewport, height: 440 });
    await expect(
      page.getByRole('button', { name: 'Save layout', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize(viewport);
    await page
      .locator('#editorialPreview')
      .evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({
      path: testInfo.outputPath('editorial-preview.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'Save layout', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#workspaceEditorial')).toContainText(
      'At the garden gate',
    );
    await expect(page.locator('#workspaceEditorial')).toContainText(
      'The afternoon',
    );
    const book = await (
      await page.request.get(`/api/fiction/${story.id}/book/json`)
    ).json();
    expect(book.volumes.map((volume) => volume.title)).toEqual([
      story.title,
      'The afternoon',
    ]);
    expect(book.volumes[0].chapters[0].pages).toHaveLength(2);
    expect(book.volumes[1].chapters[0].pages).toHaveLength(3);
    expect(book.volumes.flatMap((volume) => volume.chapters)).toHaveLength(2);
    const current = (
      await (await page.request.get(`/api/fiction/${story.id}`)).json()
    ).story;
    expect(current.state.facts).toEqual(story.state.facts);
    expect(paid).toBe(0);
    await page.reload();
    await expect(page.locator('#workspaceEditorial')).toContainText(
      'Tea after the rain',
    );
    await page.screenshot({
      path: testInfo.outputPath('chronicle-editorial.png'),
      fullPage: true,
    });
  });
  test('layout drafts recover after reload and Lock clears private editor content', async ({
    page,
  }) => {
    await start(page);
    await organize(page);
    await page
      .getByLabel('Chapter title', { exact: true })
      .fill('A private unfinished heading');
    await page
      .getByRole('button', {
        name: 'Save private layout draft now',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toContainText('saved on the server');
    await page.reload();
    await organize(page);
    await expect(page.getByLabel('Chapter title', { exact: true })).toHaveValue(
      'A private unfinished heading',
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await page.locator('#lockBtn').click();
    await expect(page.locator('.dialog-manager__body')).not.toContainText(
      'A private unfinished heading',
    );
  });
  test('historical chapter inspection is read-only and fork preview names the restored layout', async ({
    page,
  }) => {
    const story = await start(page);
    await organize(page);
    await page
      .getByLabel('Chapter title', { exact: true })
      .fill('A saved layout');
    await page
      .getByRole('button', { name: 'Save layout', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const current = (
      await (await page.request.get(`/api/fiction/${story.id}`)).json()
    ).story;
    const fork = await apiPost(page, `/api/fiction/${story.id}/branches`, {
      expected_revision: current.revision,
      beat_id: story.head_beat_id,
      name: 'Before the layout',
    });
    expect(fork.status()).toBe(201);
    await page.reload();
    await expect(page.locator('#workspaceEditorial')).toContainText(
      'Automatic episode-based',
    );
    await page
      .getByLabel('Browse path', { exact: true })
      .selectOption(story.active_branch_id);
    await expect(page.locator('#workspaceEditorial')).toContainText(
      'A saved layout',
    );
    await expect(
      page.getByRole('button', {
        name: 'Organize chapters & volumes',
        exact: true,
      }),
    ).toBeHidden();
    await page
      .getByRole('button', { name: 'Return to active path', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Organize chapters & volumes',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .locator(`.workspace-history-card[data-beat-id="${story.beats[0].id}"]`)
      .getByRole('button', { name: 'Explore from this moment', exact: true })
      .click();
    await expect(
      page.getByLabel('Continue from after this moment', { exact: true }),
    ).toHaveValue(story.beats[0].id);
    await expect(page.getByRole('dialog')).toContainText(
      'automatic episode-based chapter layout',
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
  });
  test('Back while the editor is loading cannot reopen the abandoned task', async ({
    page,
  }) => {
    await start(page);
    await page
      .locator('#workspaceRooms')
      .getByRole('link', { name: 'Desk', exact: true })
      .click();
    await page
      .locator('#workspaceRooms')
      .getByRole('link', { name: 'Chronicle', exact: true })
      .click();
    let release;
    await page.route('**/api/fiction/*/editorial', async (route) => {
      await new Promise((resolve) => {
        release = resolve;
      });
      await route.continue().catch(() => {});
    });
    await page
      .getByRole('button', { name: 'Organize chapters & volumes', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      'Opening chapter organization',
    );
    await expect.poll(() => Boolean(release)).toBe(true);
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    const response = page.waitForResponse((response) =>
      response.url().endsWith('/editorial'),
    );
    release();
    await response;
    await expect(page.locator('#editorialChapters')).toHaveCount(0);
  });
});
