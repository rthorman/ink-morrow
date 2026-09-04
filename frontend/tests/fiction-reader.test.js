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

  test('the manuscript puts the associated image above its prose and reports missing media honestly', async () => {
    const value = story(); value.state.illustrations = [{ beat_id: 'opening', asset_id: 'picture', alt_text: 'The quay.', caption: '' }];
    api.mockResolvedValue({ story: value }); await app.start();
    const article = document.querySelector('.fiction-beat');
    expect(article.firstElementChild.tagName).toBe('FIGURE');
    expect(article.querySelector('img').getAttribute('src')).toBe('/api/fiction/one/images/picture');
    article.querySelector('img').dispatchEvent(new Event('error'));
    expect(article.textContent).toContain('Illustration unavailable: The quay.');
    expect(article.textContent).toContain('Mara waits');
  });

  test('illustration dialog opens synchronously and cancellation retains its art direction without purchasing', async () => {
    const value = story(); value.illustration_generation = { provider: { id: 'p', display_name: 'Painter' }, model_id: 'image' };
    api.mockResolvedValue({ story: value }); await app.start();
    const before = api.mock.calls.length; document.getElementById('fictionIllustrate').click();
    expect(dialogs.openDialog).toHaveBeenCalledTimes(1); expect(api.mock.calls.length).toBe(before);
    const spec = dialogs.openDialog.mock.calls[0][0];
    const controls = spec.body.flatMap((node) => [...node.querySelectorAll('textarea')]);
    controls[0].value = 'The quay.'; controls[1].value = 'Blue watercolor.';
    dialogs.confirmPaid.mockResolvedValue(false);
    await spec.actions.find((item) => item.label === 'Paint with AI').onClick(jest.fn());
    expect(api.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(0);
    expect(controls[1].value).toBe('Blue watercolor.');
    expect(dialogs.openDialog).toHaveBeenCalledTimes(2);
    expect(document.getElementById('fictionIllustrate').disabled).toBe(false);
  });

  test('late image completion cannot reopen a dialog or paint a different story', async () => {
    const value = story(); value.illustration_generation = { provider: { id: 'p', display_name: 'Painter' }, model_id: 'image' };
    api.mockResolvedValue({ story: value }); await app.start();
    document.getElementById('fictionIllustrate').click(); const spec = dialogs.openDialog.mock.calls[0][0];
    spec.body.flatMap((node) => [...node.querySelectorAll('textarea')])[0].value = 'The quay.';
    let resolve; api.mockImplementation((path, method) => method === 'POST' ? new Promise((done) => { resolve = done; }) : Promise.resolve({ story: story('two') }));
    const close = jest.fn(); const pending = spec.actions.find((item) => item.label === 'Paint with AI').onClick(close); await tick();
    expect(document.getElementById('fictionIllustrate').disabled).toBe(true);
    window.history.replaceState({}, '', '#/story/two'); await app.route();
    resolve({ story: value }); await pending;
    expect(document.getElementById('fictionStoryTitle').textContent).toBe('Story two');
    expect(close).not.toHaveBeenCalled(); expect(dialogs.openDialog).toHaveBeenCalledTimes(1);
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

  test('lock and unlock preserve static save controls while private content is cleared', async () => {
    await app.start(); app.lock();
    expect(document.getElementById('fictionDownloadSave')).not.toBeNull();
    await app.start();
    expect(document.getElementById('fictionStoryTitle').textContent).toBe('Story one');
    expect(document.getElementById('fictionDownloadSave').disabled).toBe(false);
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

  test('scenario selection sends an ID without putting hidden world truth in the client', async () => {
    window.history.replaceState({}, '', '#/new');
    api.mockImplementation(async (path, method) => method === 'POST' ? { story: story() } : { scenarios: [{ id: 'drowned-bell', title: 'The Drowned Bell', premise: 'The sisters meet.', genre: 'mystery', tagline: 'A mystery.', boundaries: 'Gentle.' }] });
    await app.start(); document.querySelector('#scenarioChoices button').click();
    document.getElementById('fictionStartForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await tick();
    expect(api).toHaveBeenCalledWith('/fiction', 'POST', expect.objectContaining({ scenario_id: 'drowned-bell', cast: [] }));
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
  });

  test('the game has no manual prose editor or hand-written opening field', async () => {
    await app.start();
    expect(document.getElementById('fictionCompose')).toBeNull();
    expect(document.getElementById('fictionOpening')).toBeNull();
    expect(document.getElementById('fictionContinue')).not.toBeNull();
  });
  test('a direction defaults to this moment and ongoing focus is an explicit, releasable choice', async () => {
    await app.start(); document.getElementById('fictionDirection').value = 'Stay with Mara.';
    await app.send('steer');
    expect(api).toHaveBeenCalledWith('/fiction/one/replies', 'POST', expect.objectContaining({ input: expect.objectContaining({ direction_scope: 'moment' }) }));
    document.getElementById('fictionDirection').value = 'Watch the harbour.'; document.getElementById('fictionDirectionScope').value = 'ongoing';
    await app.send('steer');
    expect(api).toHaveBeenLastCalledWith('/fiction/one/replies', 'POST', expect.objectContaining({ input: expect.objectContaining({ direction_scope: 'ongoing' }) }));
    const focused = story(); focused.state.focus = 'Watch the harbour.'; focused.state.play_style = 'living-world'; app.renderStory(focused);
    expect(document.getElementById('fictionPlayStyle').textContent).toContain('Living-world');
    expect(document.getElementById('fictionFocusText').textContent).toContain('Watch the harbour');
    document.getElementById('fictionClearFocus').click(); await tick();
    expect(api).toHaveBeenCalledWith('/fiction/one/preferences', 'PUT', expect.objectContaining({ focus: '' }));
  });
  test('invitations fill an editable draft without purchasing or overwriting existing text', async () => {
    await app.start(); const reads = api.mock.calls.length;
    document.querySelector('#fictionInvitations button').click();
    const direction = document.getElementById('fictionDirection').value;
    expect(direction).toContain('different things'); expect(api).toHaveBeenCalledTimes(reads); expect(dialogs.confirmPaid).not.toHaveBeenCalled();
    document.querySelectorAll('#fictionInvitations button')[1].click();
    expect(document.getElementById('fictionDirection').value).toBe(direction);
    expect(document.getElementById('fictionContinue').disabled).toBe(false);
  });
  test('an unchanged challenge uses its free ruling without paid consent or clearing a separate draft', async () => {
    const value = story(); value.state.challenges = [{ id: 'gate', label: 'Borrow the key', actor_id: 'mara', approaches: [{ id: 'ask', label: 'Ask for the key' }] }];
    api.mockImplementation(async (path) => path.endsWith('/challenge-review') ? { review: { requires_generation: false } } : { story: value, repeated_adjudication: true });
    await app.start(); document.getElementById('fictionDirection').value = 'My separate direction.';
    document.querySelector('#fictionChallenges button').click(); await tick(); await tick();
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('/fiction/one/replies', 'POST', expect.objectContaining({ input: expect.objectContaining({ challenge_id: 'gate', approach_id: 'ask' }) }));
    expect(document.getElementById('fictionDirection').value).toBe('My separate direction.');
    expect(document.getElementById('fictionStatus').textContent).toContain('No AI request');
  });
  test('a stale challenge review cannot open a paid review after navigation', async () => {
    await app.start(); let resolve;
    api.mockImplementation((path) => path.endsWith('/challenge-review') ? new Promise((done) => { resolve = done; }) : Promise.resolve({ stories: [] }));
    const pending = app.send('steer', { challenge_id: 'gate', approach_id: 'ask', text: 'Ask for the key.' });
    expect(document.getElementById('fictionContinue').disabled).toBe(true);
    window.history.replaceState({}, '', '#/stories'); await app.route();
    resolve({ review: { requires_generation: true } }); await pending;
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
    expect(api.mock.calls.some(([path]) => path.endsWith('/replies'))).toBe(false);
  });
  test('evidence links open immediately and show a safe local source without purchasing', async () => {
    const value = story(); value.state.facts = [{ id: 'promise', text: 'Mara promised.', value: null, evidence_beat_id: 'evidence' }];
    api.mockImplementation(async (path) => path.includes('/evidence/') ? { beat: { summary: 'A fact was corrected.', prose: '', changes: [{ fact: { text: 'Mara promised.' } }] } } : { story: value });
    await app.start(); document.querySelector('#fictionFacts button').click();
    expect(dialogs.openDialog).toHaveBeenCalledTimes(1); const body = dialogs.openDialog.mock.calls[0][0].body[0];
    expect(body.textContent).toContain('Loading'); await tick();
    expect(body.textContent).toContain('Mara promised'); expect(body.textContent).toContain('not rewritten'); expect(dialogs.confirmPaid).not.toHaveBeenCalled();
  });
  test('locking clears the added private influence surfaces', async () => {
    const value = story(); value.state.focus = 'Private ongoing direction.'; api.mockResolvedValue({ story: value });
    await app.start(); app.lock();
    for (const id of ['fictionFocusText', 'fictionInvitations', 'fictionChallenges', 'fictionPlayStyle']) expect(document.getElementById(id).textContent).toBe('');
  });

  test('a failed factual correction keeps its text, reason and dialog for another attempt', async () => {
    await app.start(); document.getElementById('fictionCorrect').click();
    const spec = dialogs.openDialog.mock.calls.at(-1)[0];
    const value = spec.body.flatMap((node) => [...node.querySelectorAll('textarea')])[0];
    const reason = spec.body.flatMap((node) => [...node.querySelectorAll('input')])[0];
    value.value = 'Mara owns the boat.'; reason.value = 'The earlier description was mistaken.';
    api.mockRejectedValueOnce(new Error('Storage is unavailable.'));
    const close = jest.fn();
    await spec.actions.find((item) => item.label === 'Save correction').onClick(close);
    expect(close).not.toHaveBeenCalled();
    expect(value.value).toBe('Mara owns the boat.');
    expect(reason.value).toBe('The earlier description was mistaken.');
    expect(spec.body.find((node) => node.getAttribute('role') === 'alert').textContent).toContain('Storage is unavailable');
    expect(document.getElementById('fictionCorrect').disabled).toBe(false);
    expect(dialogs.confirmPaid).not.toHaveBeenCalled();
  });
});
