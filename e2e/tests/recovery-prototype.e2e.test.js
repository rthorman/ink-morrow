import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createPrototypeServer } from '../../scripts/serve-recovery-prototype.cjs';

let server;
let origin;
test.beforeAll(async () => {
  server = createPrototypeServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ page }) => { await page.goto(origin); });

test('all five rooms remain usable and return to the same reading position without API traffic', async ({ page }) => {
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await expect(page.getByRole('heading', { name: 'The kindness of a small task', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.locator('.reader').evaluate(element => { element.scrollTop = 150; });
  const scroll = await page.locator('.reader').evaluate(element => element.scrollTop);
  for (const room of ['Chronicle', 'Codex', 'Gallery', 'Gate']) {
    await page.getByRole('link', { name: room, exact: true }).click();
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('link', { name: room, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.getByRole('link', { name: 'Desk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Two cups, no questions', exact: true })).toBeVisible();
  expect(await page.locator('.reader').evaluate(element => element.scrollTop)).toBe(scroll);
  expect(requests.filter(url => !url.startsWith(origin) || url.includes('/api/'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('paid-review cancellation, Back, reload and Escape keep the example direction', async ({ page }) => {
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await page.getByRole('textbox', { name: 'What deserves attention?' }).fill('Keep the silence. Let them fix the clock.');
  await page.getByRole('button', { name: 'Review simulated request', exact: true }).click();
  await expect(page.getByText('Actual dispatches: zero.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Back · keep draft', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What deserves attention?' })).toHaveValue('Keep the silence. Let them fix the clock.');
  await page.goBack();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Steer', exact: true })).toBeFocused();
  await page.reload();
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What deserves attention?' })).toHaveValue('Keep the silence. Let them fix the clock.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('a historical fork preserves the original future and excludes future evidence', async ({ page }) => {
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue story', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore from this moment', exact: true }).click();
  await page.getByRole('textbox', { name: 'Path name' }).fill('Stay with the rain');
  await page.getByRole('button', { name: 'Create example path · no AI', exact: true }).click();
  await page.getByRole('link', { name: 'Codex', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The kitchen clock is running' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Private planning', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The letter in the upstairs room' })).toBeVisible();
  await page.getByRole('button', { name: 'All public', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The letter in the upstairs room' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Chronicle', exact: true }).click();
  await page.getByLabel('Path to inspect').selectOption('main');
  await expect(page.getByRole('heading', { name: 'The kindness of a small task', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Desk', exact: true }).click();
  await page.getByRole('button', { name: 'Latest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Make this my active path', exact: true })).toBeVisible();
});

test('simulated failure and unknown outcome preserve prose and require another review', async ({ page }) => {
  await page.getByRole('button', { name: 'Continue story', exact: true }).click();
  await page.getByLabel('Simulated outcome').selectOption('failure');
  await page.getByRole('button', { name: 'Run simulated request', exact: true }).click();
  await page.getByRole('link', { name: 'Chronicle', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Every path leaves a trace' })).toBeVisible();
  await page.getByRole('link', { name: 'Desk', exact: true }).click();
  await page.getByRole('button', { name: 'Finish simulated request', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Story unchanged');
  await page.getByRole('button', { name: 'Review before another attempt', exact: true }).click();
  await page.getByLabel('Simulated outcome').selectOption('unknown');
  await page.getByRole('button', { name: 'Run simulated request', exact: true }).click();
  await page.getByRole('button', { name: 'Finish simulated request', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Outcome unknown');
  await expect(page.getByRole('button', { name: 'Continue story', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check simulated request status', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve example as failed · no dispatch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue story', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'The kindness of a small task', exact: true })).toBeVisible();
});

test('studio candidate comparison keeps fields and changes no story', async ({ page }) => {
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Open full studio', exact: true }).click();
  await page.getByRole('textbox', { name: 'Visible description', exact: true }).fill('A careful bookbinder.');
  await page.getByRole('button', { name: 'Compare a sample development', exact: true }).click();
  await page.getByRole('button', { name: 'Back to unchanged fields', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Visible description', exact: true })).toHaveValue('A careful bookbinder.');
  await page.getByRole('button', { name: 'Close · keep draft', exact: true }).click();
  await page.getByRole('button', { name: 'Open full studio', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Visible description', exact: true })).toHaveValue('A careful bookbinder.');
});

test('layout reflows with larger text and short keyboard-height viewports', async ({ page }) => {
  await page.getByRole('button', { name: 'Reading settings', exact: true }).click();
  await page.getByLabel('Reading size').selectOption('1.75');
  await page.getByRole('button', { name: 'Apply reading size', exact: true }).click();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  const readerBox = await page.locator('.reader').boundingBox();
  const controlsBox = await page.locator('.desk-controls').boundingBox();
  expect(readerBox.y + readerBox.height).toBeLessThanOrEqual(controlsBox.y + 1);
  await page.setViewportSize({ width: 800, height: 450 });
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await page.getByRole('textbox', { name: 'What deserves attention?' }).fill('A direction with the keyboard open.');
  await page.getByRole('button', { name: 'Review simulated request', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run simulated request', exact: true })).toBeInViewport();
});

test('accessibility smoke checks cover reading, collection and modal tasks', async ({ page }) => {
  for (const room of ['Desk', 'Codex', 'Gallery']) {
    await page.getByRole('link', { name: room, exact: true }).click();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
  await page.getByRole('button', { name: 'Upload an image', exact: true }).click();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
});

test('prototype server exposes no backend, credentials, database or API surface', async ({ request }) => {
  for (const route of ['/backend/.env', '/backend/src/db.js', '/database-v5/ink-morrow-5.db', '/api/fiction', '/AGENTS.md', '/frontend/styles/%2e%2e/%2e%2e/backend/server.js']) {
    expect((await request.get(origin + route)).status()).toBe(404);
  }
  expect((await request.post(origin + '/')).status()).toBe(405);
});

test('self-contained review artifact works without fetching scripts, fonts or images', async ({ page }) => {
  await page.goto('about:blank');
  const requests = [];
  const errors = [];
  page.on('request', request => { if (request.url().startsWith('http')) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/preview.html');
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await page.getByRole('textbox', { name: 'What deserves attention?' }).fill('Keep this moment quiet.');
  await page.getByRole('button', { name: 'Review simulated request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review the request', exact: true })).toBeVisible();
  expect(requests).toEqual([origin + '/preview.html']);
  expect(errors).toEqual([]);
});

test('demo Lock hides all rooms and clears the synthetic direction buffer', async ({ page }) => {
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await page.getByRole('textbox', { name: 'What deserves attention?' }).fill('A sample private direction.');
  await page.getByRole('button', { name: 'Close · keep draft', exact: true }).click();
  await page.getByRole('button', { name: 'Lock demo', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Story rooms' })).toHaveCount(0);
  await expect(page.getByText('A sample private direction.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to the prototype', exact: true }).click();
  await page.getByRole('button', { name: 'Steer', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What deserves attention?' })).toHaveValue('');
});

test('world and Scribe studios keep distinct reference identities and candidates', async ({ page }) => {
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  for (const [collection, title, name] of [['Worlds', 'World studio', 'Greyhaven'], ['Scribes', 'Scribe studio', 'The attentive observer']]) {
    await page.getByRole('button', { name: collection, exact: true }).click();
    await page.getByRole('button', { name: 'Open full studio', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
    await page.getByRole('button', { name: 'Compare a sample development', exact: true }).click();
    await page.getByRole('button', { name: 'Use sample visible description', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
    await page.getByRole('button', { name: 'Close · keep draft', exact: true }).click();
  }
});
