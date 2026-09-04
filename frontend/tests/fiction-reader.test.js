import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { createFictionApp } from '../app/fiction/app.js';
import { createProviderPanel } from '../app/fiction/providers.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const story = (id = 'one') => ({
  id, title: `Story ${id}`, premise: 'A reunion.', genre: 'drama', revision: 1, active_branch_id: 'branch', head_beat_id: 'opening', pending: false, has_earlier: false,
  state: { cast: [{ id: 'mara', name: 'Mara', description: 'An old friend.' }], facts: [], control: { character_id: null }, episode: { number: 1, title: 'The beginning', status: 'active', summary: '' } },
  branches: [{ id: 'branch', name: 'Original path' }], beats: [{ id: 'opening', kind: 'opening', prose: 'Mara waits at the quay.', summary: 'The reunion.', changes: [], input: {} }],
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('5.0 reader-director interface', () => {
  let app; let api; let dialogs;
  beforeEach(() => {
    document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i, '').replace(/<html[^>]*>|<\/html>/gi, '');
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'test-id' });
    window.history.replaceState({}, '', '#/story/one');
    api = jest.fn().mockImplementation(async (path) => path === '/fiction' ? { stories: [] } : { story: story() });
    dialogs = { close: jest.fn(), confirmPaid: jest.fn().mockResolvedValue(true), openDialog: jest.fn() };
    app = createFictionApp({ api, dialogs });
  });
  afterEach(() => app?.dispose());

  test('does no private reads before unlock and requires no avatar', async () => {
    expect(api).not.toHaveBeenCalled();
    await app.start();
    expect(document.getElementById('fictionControl').textContent).toContain('reader-director');
    expect([...document.getElementById('fictionInputKind').options].map((entry) => entry.value)).toEqual(['steer', 'ask']);
    expect(document.getElementById('fictionContinue').disabled).toBe(false);
    expect(document.getElementById('fictionDetails').hidden).toBe(true);
  });

  test('Continue immediately shows busy state and cannot double-submit', async () => {
    await app.start();
    let resolve;
    api.mockImplementation((path, method) => method === 'POST' ? new Promise((done) => { resolve = done; }) : Promise.resolve({ story: story() }));
    const pending = app.send('follow');
    expect(document.getElementById('fictionContinue').disabled).toBe(true);
    expect(document.getElementById('fictionContinue').textContent).toBe('Working…');
    await app.send('follow'); await tick();
    expect(api.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
    resolve({ story: story(), cost_usd: 0.01 }); await pending;
    expect(document.getElementById('fictionContinue').disabled).toBe(false);
  });

  test('cancelling paid review preserves direction and sends no paid request', async () => {
    await app.start(); dialogs.confirmPaid.mockResolvedValue(false);
    document.getElementById('fictionDirection').value = 'Stay with Mara.';
    await app.send('steer');
    expect(document.getElementById('fictionDirection').value).toBe('Stay with Mara.');
    expect(api.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(0);
  });

  test('a failed request keeps the draft and uses only a free reconciliation read', async () => {
    await app.start();
    api.mockImplementation(async (path, method) => { if (method === 'POST') throw new Error('Connection lost.'); return { story: story() }; });
    document.getElementById('fictionDirection').value = 'Let them talk.';
    await app.send('steer');
    expect(document.getElementById('fictionDirection').value).toBe('Let them talk.');
    expect(api.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
    expect(document.getElementById('fictionStatus').textContent).toContain('Connection lost');
  });

  test('late generation cannot paint another story', async () => {
    await app.start(); let resolve;
    api.mockImplementation((path, method) => method === 'POST' ? new Promise((done) => { resolve = done; }) : Promise.resolve({ story: story('two') }));
    const pending = app.send('follow'); await tick();
    window.history.replaceState({}, '', '#/story/two'); await app.route();
    resolve({ story: story('one') }); await pending;
    expect(document.getElementById('fictionStoryTitle').textContent).toBe('Story two');
  });

  test('late earlier-history reads cannot cross a branch change', async () => {
    const value = story(); value.has_earlier = true;
    api.mockResolvedValue({ story: value }); await app.start();
    let resolve; api.mockImplementation(() => new Promise((done) => { resolve = done; }));
    document.getElementById('fictionEarlier').click();
    const next = story(); next.revision = 2; next.active_branch_id = 'alternate'; next.beats[0].prose = 'The other path.';
    app.renderStory(next);
    resolve({ story: value }); await tick();
    expect(document.getElementById('fictionProse').textContent).toContain('The other path.');
    expect(app.getCurrent().active_branch_id).toBe('alternate');
    expect(document.getElementById('fictionEarlier').disabled).toBe(false);
  });

  test('locking clears private story state and ignores delayed reads', async () => {
    let resolve; api.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = app.start(); app.lock(); resolve({ story: story() }); await pending;
    expect(document.getElementById('fictionProse').textContent).toBe('');
    expect(app.getCurrent()).toBeNull();
    expect(document.getElementById('readerScreen').hidden).toBe(true);
  });

  test('taking a character is explicit and only then adds Act and Say', async () => {
    await app.start();
    document.querySelector('#fictionCast button').click();
    expect(api.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(0);
    const spec = dialogs.openDialog.mock.calls[0][0];
    expect(spec.title).toBe('Inhabit Mara?');
    const controlled = story(); controlled.state.control.character_id = 'mara';
    api.mockResolvedValue({ story: controlled });
    await spec.actions[1].onClick(jest.fn());
    expect([...document.getElementById('fictionInputKind').options].map((entry) => entry.value)).toEqual(['steer', 'ask', 'act', 'say']);
  });

  test('renders prose as text rather than executable markup', async () => {
    const value = story(); value.beats[0].prose = '<img src=x onerror=alert(1)> A strange inscription.';
    api.mockResolvedValue({ story: value }); await app.start();
    expect(document.querySelector('#fictionProse img')).toBeNull();
    expect(document.getElementById('fictionProse').textContent).toContain('<img');
  });

  test('ending provides a resting point without further provider requests', async () => {
    const value = story(); value.state.episode.status = 'ended'; value.state.episode.summary = 'They understand each other.';
    api.mockResolvedValue({ story: value }); await app.start();
    expect(document.getElementById('fictionComposer').hidden).toBe(true);
    expect(document.getElementById('fictionEnded').hidden).toBe(false);
    await app.send('follow'); expect(api).toHaveBeenCalledTimes(1);
  });

  test('new stories can start without a cast or paid call', async () => {
    window.history.replaceState({}, '', '#/new'); await app.start();
    document.getElementById('fictionTitle').value = 'A quiet place';
    document.getElementById('fictionPremise').value = 'An old garden reopens.';
    document.getElementById('fictionStartForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    expect(api).toHaveBeenCalledWith('/fiction', 'POST', expect.objectContaining({ cast: [], title: 'A quiet place' }));
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
  });

  test('provider settings use the real chat capability and never persist keys', async () => {
    const providerApi = jest.fn().mockResolvedValue({ profiles: [{ id: 'profile', display_name: 'Private provider', capabilities: ['chat', 'catalog'], credential: { state: 'missing', read_only: false } }], roles: [{ role: 'scribe', profile_id: 'profile', model_id: 'model', status: 'unconfigured' }], vault: { state: 'empty' } });
    const panel = createProviderPanel({ api: providerApi }); await panel.render();
    expect(document.getElementById('fictionProviderPanel').textContent).toContain('Private provider');
    const passwordInputs = document.querySelectorAll('#fictionProviderPanel input[type="password"]');
    passwordInputs[0].value = 'test-private-key';
    expect(localStorage.getItem('test-private-key')).toBeNull();
    panel.clear();
    expect(passwordInputs[0].value).toBe('');
    expect(document.getElementById('fictionProviderPanel').textContent).toBe('');
  });
});
