import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createFictionApp } from '../app/fiction/app.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const generation = { provider: { id: 'images', display_name: 'Illustrator test' }, model_id: 'image-model' };
const entries = Object.fromEntries(['world', 'character', 'scribe'].map((kind) => [kind, { id: `${kind}-id`, kind, name: `My ${kind}`, description: `Visible ${kind}`, data: { appearance: '', focus_areas: [] }, image_id: `${kind}-image`, image_alt: `${kind} picture`, revision: 1, pending: false }]));
const metadata = { fields: { world: { setting: 1000, lore: 6000 }, character: { appearance: 1000, motive: 1000 }, scribe: { appearance: 1000 } }, scribe: { canon: { definition: 'An adult catgirl.' }, enums: { diction: ['plain', 'balanced'] }, focus_areas: ['dialogue'] }, generation, spend: { known_usd: 0, unknown_attempts: 0 } };
const story = () => ({ id: 'story-id', title: 'Visual story', revision: 1, active_branch_id: 'branch', head_beat_id: 'opening', pending: false,
  state: { cast: [{ id: 'character-id', name: 'My character', description: 'Visible person' }], library: { world: entries.world, scribe: entries.scribe }, visuals: ['cover', 'world', 'character', 'scribe'].map((kind) => ({ kind, subject_id: kind === 'character' ? 'character-id' : null, asset_id: `${kind}-copy`, alt_text: `${kind} copy` })), facts: [], control: { character_id: null }, episode: { number: 1, title: 'Opening', status: 'active' } },
  branches: [{ id: 'branch', name: 'Original path' }], beats: [{ id: 'opening', kind: 'opening', prose: 'A story begins.', changes: [], input: {} }], illustration_generation: generation });
const control = (spec, caption) => {
  for (const wrapper of spec.body) {
    const label = wrapper.querySelector?.('label');
    if (label?.textContent === caption) return wrapper.querySelector('input,textarea,select');
  }
  throw new Error(`Missing ${caption}`);
};
describe('visual Library and story images', () => {
  let app; let api; let dialogs;
  beforeEach(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: randomUUID });
    document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i, '').replace(/<html[^>]*>|<\/html>/gi, '');
    window.history.replaceState({}, '', '#/catalog/world');
    dialogs = { close: jest.fn(), openDialog: jest.fn(), confirmPaid: jest.fn().mockResolvedValue(true), confirmDestructive: jest.fn().mockResolvedValue(false) };
    api = jest.fn(async (path, method, body) => {
      if (path === '/fiction/catalog/metadata') return metadata;
      if (path.startsWith('/fiction/catalog?')) return { entries: [entries[new URLSearchParams(path.split('?')[1]).get('kind')]], next_offset: null };
      if (path === '/fiction/scenarios') return { scenarios: [] };
      if (path === '/fiction' && !method) return { stories: [] };
      if (path.startsWith('/fiction/catalog') && method) return { entry: { ...entries.world, ...body?.entry } };
      return { story: story() };
    });
    app = createFictionApp({ api, dialogs });
  });
  afterEach(async () => { app.dispose(); await tick(); });
  test('catalogues are sealed until unlock, show art, and save details without a purchase', async () => {
    expect(api).not.toHaveBeenCalled(); await app.start();
    expect(document.querySelector('#catalogEntries img').alt).toBe('world picture');
    document.getElementById('catalogNew').click(); const spec = dialogs.openDialog.mock.calls.at(-1)[0];
    control(spec, 'Name').value = 'New world'; control(spec, 'Lore (may contain private setup notes)').value = 'Secret reference';
    await spec.actions.find((action) => action.label === 'Save details').onClick(jest.fn());
    expect(api).toHaveBeenCalledWith('/fiction/catalog', 'POST', expect.objectContaining({ kind: 'world', entry: expect.objectContaining({ name: 'New world', data: expect.objectContaining({ lore: 'Secret reference' }) }) }));
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
    app.lock(); expect(document.getElementById('catalogEntries').textContent).toBe(''); expect(document.getElementById('catalogScreen').hidden).toBe(true);
  });
  test('catalogue image dialog is immediate, cancels free and retains entered direction', async () => {
    await app.start(); const before = api.mock.calls.length;
    [...document.querySelectorAll('#catalogEntries button')].find((node) => node.textContent === 'Image: upload or paint').click();
    let spec = dialogs.openDialog.mock.calls.at(-1)[0]; expect(spec.title).toBe('Image for My world'); expect(api.mock.calls).toHaveLength(before);
    control(spec, 'Image description').value = 'The quay'; control(spec, 'Art direction (AI only)').value = 'Gentle colour';
    dialogs.confirmPaid.mockResolvedValue(false);
    await spec.actions.find((action) => action.label === 'Paint with AI').onClick(jest.fn());
    expect(api.mock.calls.some(([path]) => path.endsWith('/generate'))).toBe(false);
    spec = dialogs.openDialog.mock.calls.at(-1)[0]; expect(control(spec, 'Art direction (AI only)').value).toBe('Gentle colour');
  });
  test('setup selection is visual, survives leaving the form and creates no automatic painting', async () => {
    window.history.replaceState({}, '', '#/new'); await app.start(); await tick();
    document.querySelector('[aria-label="Selected world"]').value = 'world-id'; document.querySelector('[aria-label="Selected world"]').dispatchEvent(new Event('change'));
    document.querySelector('[aria-label="Selected scribe"]').value = 'scribe-id'; document.querySelector('#fictionCatalogueSetup input[type=checkbox]').checked = true;
    expect(document.querySelectorAll('#fictionCatalogueSetup img')).toHaveLength(2);
    document.getElementById('fictionTitle').value = 'Draft story'; document.getElementById('fictionPremise').value = 'A situation.';
    window.history.replaceState({}, '', '#/catalog/character'); await app.route(); window.history.replaceState({}, '', '#/new'); await app.route(); await tick();
    expect(document.querySelector('[aria-label="Selected world"]').value).toBe('world-id'); expect(document.querySelector('#fictionCatalogueSetup input:checked').value).toBe('character-id');
    document.getElementById('fictionStartForm').dispatchEvent(new Event('submit', { cancelable: true })); await tick();
    expect(api).toHaveBeenCalledWith('/fiction', 'POST', expect.objectContaining({ title: 'Draft story', library: { world_id: 'world-id', scribe_id: 'scribe-id', character_ids: ['character-id'] } }));
    expect(api.mock.calls.some(([path]) => path.endsWith('/generate'))).toBe(false);
  });
  test.each(['cover', 'world', 'character', 'scribe'])('%s image is visible and its paint action is explicit and target-bound', async (kind) => {
    window.history.replaceState({}, '', '#/story/story-id'); await app.start();
    expect(document.querySelector(`img[alt="${kind} copy"]`)).not.toBeNull();
    if (kind === 'cover') document.getElementById('fictionCoverEdit').click();
    else if (kind === 'character') [...document.querySelectorAll('#fictionCast button')].find((node) => node.textContent.startsWith('Portrait')).click();
    else [...document.querySelectorAll('#fictionReferences article')].find((node) => node.textContent.includes(`My ${kind}`)).querySelector('button').click();
    const spec = dialogs.openDialog.mock.calls.at(-1)[0]; expect(spec.title).toBe(`Story ${kind} image`);
    await spec.actions.find((action) => action.label === 'Paint with AI').onClick(jest.fn());
    expect(api).toHaveBeenCalledWith('/fiction/story-id/images/generate', 'POST', expect.objectContaining({ expected_revision: 1, input: expect.objectContaining({ kind, subject_id: kind === 'character' ? 'character-id' : null, provider_id: 'images', model: 'image-model' }) }));
    expect(dialogs.confirmPaid).toHaveBeenCalledTimes(1);
  });
  test('late catalogue reads cannot refill private content after lock', async () => {
    let resolve; api.mockImplementation((path) => path === '/fiction/catalog/metadata' ? Promise.resolve(metadata) : new Promise((done) => { resolve = done; }));
    const pending = app.start(); app.lock(); resolve({ entries: [entries.world] }); await pending;
    expect(document.getElementById('catalogEntries').textContent).toBe('');
  });
  test('catalogue pagination replaces the card window and stays free', async () => {
    api.mockImplementation(async (path) => {
      if (path === '/fiction/catalog/metadata') return metadata;
      const later = path.endsWith('offset=80');
      return { entries: [{ ...entries.world, name: later ? 'Later world' : 'First world' }], next_offset: later ? null : 80 };
    });
    await app.start(); document.getElementById('catalogNext').click(); await tick();
    expect(document.querySelectorAll('#catalogEntries article')).toHaveLength(1); expect(document.getElementById('catalogEntries').textContent).toContain('Later world');
    expect(document.getElementById('catalogNext').hidden).toBe(true); expect(document.getElementById('catalogPrevious').hidden).toBe(false);
    document.getElementById('catalogPrevious').click(); await tick(); expect(document.getElementById('catalogEntries').textContent).toContain('First world');
    expect(dialogs.confirmPaid).not.toHaveBeenCalled(); expect(api.mock.calls.every(([, method]) => !method)).toBe(true);
  });
  test('catalogue deletion uses explicit shared destructive confirmation and exact revision', async () => {
    await app.start(); const remove = () => [...document.querySelectorAll('#catalogEntries button')].find((node) => node.textContent === 'Delete entry').click();
    remove(); await tick(); expect(api.mock.calls.some(([, method]) => method === 'DELETE')).toBe(false);
    expect(dialogs.confirmDestructive).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete My world?', body: expect.stringContaining('one reusable entry') }));
    dialogs.confirmDestructive.mockResolvedValue(true); remove(); await tick();
    expect(api).toHaveBeenCalledWith('/fiction/catalog/world-id', 'DELETE', { expected_revision: 1 });
  });
});
