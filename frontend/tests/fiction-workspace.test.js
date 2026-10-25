import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { createFictionApp } from '../app/fiction/app.js';
import { parseWorkspace, getBookmark, putBookmark } from '../app/fiction/workspace-state.js';
import { createDialogManager, wireModal, forceCloseAllModals } from '../app/core/dialogs.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const fixture = () => ({
  id: 'work', title: 'A house to return to', revision: 1, active_branch_id: 'path', head_beat_id: 'third', has_earlier: false, pending: false,
  branches: [{ id: 'path', name: 'Homecoming' }],
  state: { cast: [], facts: [], control: { character_id: null }, episode: { number: 1, title: 'At home', status: 'active' }, visuals: [], illustrations: [] },
  beats: ['first', 'second', 'third'].map(id => ({ id, kind: 'scene', prose: `Passage ${id}.`, summary: `Moment ${id}`, input: {}, changes: [] })),
});
describe('current-fiction workspace adapters', () => {
  let app; let api; let dialogs;
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => 'test-request' });
    document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i, '').replace(/<html[^>]*>|<\/html>/gi, '');
    history.replaceState(null, '', '#/story/work/desk');
    dialogs = { close: jest.fn(), openDialog: jest.fn(), confirmPaid: jest.fn().mockResolvedValue(true) };
    api = jest.fn(async () => ({ story: fixture() }));
    app = createFictionApp({ api, dialogs });
  });
  afterEach(() => { app?.dispose(); localStorage.clear(); });
  test('all five real room adapters preserve the cursor and make no extra request', async () => {
    await app.start(); document.getElementById('fictionPreviousPage').click();
    const reads = api.mock.calls.length;
    for (const room of ['chronicle', 'codex', 'gallery', 'gate', 'desk']) {
      history.replaceState(null, '', `#/story/work/${room}`); await app.route();
      expect(document.querySelector(`#workspaceRooms [data-room="${room}"]`).getAttribute('aria-current')).toBe('page');
    }
    expect(document.getElementById('fictionProse').textContent).toContain('Passage second');
    expect(api).toHaveBeenCalledTimes(reads);
    expect(document.getElementById('fictionExportBook').closest('#workspaceGate')).not.toBeNull();
    expect(document.getElementById('fictionCorrect').closest('#fictionDetails')).not.toBeNull();
    expect(document.getElementById('fictionIllustrate').closest('#workspaceGallery')).not.toBeNull();
    expect(document.getElementById('fictionBranch').closest('#workspaceChronicle')).not.toBeNull();
  });
  test('a valid old bookmark outside the loaded window uses ancestry-checked free reads', async () => {
    putBookmark('work', { branchId: 'path', beatId: 'older', paragraph: 0, fraction: 0 });
    api.mockImplementation(async path => path.includes('/evidence/') ? { beat: { id: 'older', kind: 'scene', prose: 'An older passage.', summary: 'Older', changes: [] } } : path.includes('?before=') ? { story: { ...fixture(), beats: [], has_earlier: false } } : { story: fixture() });
    await app.start();
    expect(document.getElementById('fictionProse').textContent).toContain('An older passage');
    expect(document.getElementById('fictionContinue').textContent).toContain('Continue latest on Homecoming');
    expect(api.mock.calls.every(([, method]) => !method)).toBe(true);
    document.getElementById('fictionLatestPage').click(); await tick();
    expect(document.getElementById('fictionProse').textContent).toContain('Passage third');
  });
  test('a removed or foreign bookmark fails closed without changing story state', async () => {
    putBookmark('work', { branchId: 'path', beatId: 'foreign', paragraph: 0, fraction: 0 });
    api.mockImplementation(async path => { if (path.includes('/evidence/') || path.includes('?before=')) throw new Error('Not on this path.'); return { story: fixture() }; });
    await app.start();
    expect(document.getElementById('fictionProse').textContent).toContain('Passage third');
    expect(document.getElementById('fictionStatus').textContent).toContain('saved reading position is unavailable');
    expect(api.mock.calls.every(([, method]) => !method)).toBe(true);
  });
  test('late bookmark recovery cannot replace a passage explicitly selected meanwhile', async () => {
    putBookmark('work', { branchId: 'path', beatId: 'older', paragraph: 0, fraction: 0 });
    let finishWindow; let finishEvidence;
    api.mockImplementation(path => path.includes('?before=') ? new Promise(resolve => { finishWindow = resolve; }) : path.includes('/evidence/') ? new Promise(resolve => { finishEvidence = resolve; }) : Promise.resolve({ story: fixture() }));
    const starting = app.start(); await tick();
    history.replaceState(null, '', '#/story/work/chronicle'); await app.route();
    document.querySelector('#workspaceHistory button').click();
    finishWindow({ story: { ...fixture(), beats: [], has_earlier: false } });
    finishEvidence({ beat: { id: 'older', kind: 'scene', prose: 'An older passage.', summary: 'Older' } });
    await starting;
    expect(document.getElementById('fictionProse').textContent).toContain('Passage first.');
  });
  test('reading and room navigation remain available while a paid request is pending', async () => {
    await app.start(); let finish;
    api.mockImplementation((path, method) => method === 'POST' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ story: fixture() }));
    const pending = app.send('follow'); await tick();
    document.getElementById('fictionPreviousPage').click();
    expect(document.getElementById('fictionProse').textContent).toContain('Passage second');
    history.replaceState(null, '', '#/story/work/chronicle'); await app.route();
    expect(document.getElementById('workspaceChronicle').hidden).toBe(false);
    finish({ story: { ...fixture(), revision: 2 } }); await pending;
    expect(document.getElementById('workspaceChronicle').hidden).toBe(false);
    expect(document.getElementById('fictionProse').textContent).toContain('Passage second');
  });
  test('contribution tasks separate Ask and Steer drafts and keep newer identical edits', async () => {
    await app.start();
    document.getElementById('workspaceSteer').click();
    const direction = document.getElementById('fictionDirection'); direction.value = 'Let the silence remain.'; direction.dispatchEvent(new Event('input'));
    const kind = document.getElementById('fictionInputKind'); kind.value = 'ask'; kind.dispatchEvent(new Event('change'));
    expect(direction.value).toBe(''); direction.value = 'What happened?'; direction.dispatchEvent(new Event('input'));
    kind.value = 'steer'; kind.dispatchEvent(new Event('change')); expect(direction.value).toBe('Let the silence remain.');
    let finish; api.mockImplementation((path, method) => method === 'POST' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ story: fixture() }));
    const pending = app.send('steer'); await tick();
    direction.value = 'Changed'; direction.dispatchEvent(new Event('input')); direction.value = 'Let the silence remain.'; direction.dispatchEvent(new Event('input'));
    finish({ story: fixture() }); await pending;
    expect(direction.value).toBe('Let the silence remain.');
  });
  test('Lock clears real room content, task text and account fields immediately', async () => {
    await app.start(); document.getElementById('workspaceSteer').click();
    document.getElementById('fictionDirection').value = 'Private direction'; document.getElementById('passwordCurrent').value = 'secret';
    app.lock();
    for (const id of ['workspaceHistory', 'workspaceImages', 'workspaceRooms', 'fictionProse', 'workspaceTaskTarget']) expect(document.getElementById(id).textContent).toBe('');
    expect(document.getElementById('fictionDirection').value).toBe(''); expect(document.getElementById('passwordCurrent').value).toBe('');
    expect(document.getElementById('workspaceTask').hidden).toBe(true);
  });
});
test('workspace routes and bookmark storage are bounded, branch-specific and contain no prose', () => {
  localStorage.clear();
  expect(parseWorkspace('#/story/work/chronicle')).toEqual({ storyId: 'work', room: 'chronicle', task: null });
  expect(parseWorkspace('#/story/work/desk?task=say').task).toBe('say');
  expect(parseWorkspace('#/story/work/private')).toBeNull();
  putBookmark('work', { branchId: 'a', beatId: 'one', paragraph: 2, fraction: .5, prose: 'Never persist this' });
  putBookmark('work', { branchId: 'b', beatId: 'two', paragraph: 0, fraction: 0 });
  expect(getBookmark('work', 'a').beatId).toBe('one'); expect(getBookmark('work', 'b').beatId).toBe('two');
  expect(localStorage.getItem('im-fiction-bookmarks-v1')).not.toContain('Never persist this');
  localStorage.clear();
});

test('a shared paid review hides the underlying task and programmatic cancellation resolves no', async () => {
  localStorage.clear(); document.body.innerHTML = '<div id="under" hidden><div role="dialog"><button>Return here</button></div></div>';
  const under = wireModal('under'); under.open();
  const manager = createDialogManager(); const pending = manager.confirmPaid({ title: 'Review', body: 'A real paid boundary', confirmLabel: 'Buy once' });
  expect(document.getElementById('under').getAttribute('aria-hidden')).toBe('true');
  expect(document.getElementById('under').inert).toBe(true);
  manager.cancel(); expect(await pending).toBe(false);
  expect(document.getElementById('under').hasAttribute('aria-hidden')).toBe(false);
  expect(document.getElementById('under').inert).toBe(false);
  under.close(); forceCloseAllModals();
});

test('approval reset distinguishes ordinary and quality consent, including the session cache', async () => {
  localStorage.clear(); document.body.innerHTML = '';
  const manager = createDialogManager();
  const pending = manager.confirmPaid({ title: 'First purchase', body: 'Review', confirmLabel: 'Approve' });
  [...document.querySelectorAll('.dialog-manager button')].find(button => button.textContent === 'Approve').click(); await pending;
  expect(manager.hasPaidConsent()).toBe(true);
  localStorage.setItem('im-paid-consent-v1:fiction-quality-test', '1');
  manager.resetPaidConsent('quality');
  expect(manager.hasPaidConsent()).toBe(true); expect(manager.hasPaidConsent('fiction-quality-test')).toBe(false);
  manager.resetPaidConsent('ordinary'); expect(manager.hasPaidConsent()).toBe(false);
  manager.cancel(); localStorage.clear();
});
