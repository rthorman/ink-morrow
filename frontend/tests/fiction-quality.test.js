import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { createFictionApp } from '../app/fiction/app.js';
import { createProviderPanel } from '../app/fiction/providers.js';
import { createDialogManager } from '../app/core/dialogs.js';
import { qualityPaidReview } from '../app/fiction/quality.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const story = (mode = 'both') => ({ id: 'quality', title: 'A quiet garden', revision: 2, active_branch_id: 'path', pending: false,
  state: { quality_mode: mode, cast: [], facts: [], control: { character_id: null }, episode: { status: 'active' } }, branches: [{ id: 'path', name: 'First' }], beats: [],
  quality_generation: { mode, available: true, review_id: 'a'.repeat(64), max_calls: mode === 'both' ? 6 : 4, calls_without_repair: mode === 'both' ? 3 : 2,
    roles: [{ role: 'scribe', label: 'Standard storyteller', provider: { id: 'text', display_name: 'Text provider' }, model_id: 'standard-model', operation_count: 4 }, { role: 'archivist', label: 'Memory support', provider: { id: 'memory', display_name: 'Memory provider' }, model_id: 'memory-model', operation_count: 2 }] },
});
describe('quality choice, progress and paid scope', () => {
  let app; let api; let dialogs;
  beforeEach(() => {
    document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i, '').replace(/<html[^>]*>|<\/html>/gi, '');
    window.localStorage.clear(); window.history.replaceState({}, '', '#/story/quality');
    let fieldId = 0; Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `fixture-${++fieldId}` });
    api = jest.fn().mockResolvedValue({ story: story() }); dialogs = { close: jest.fn(), confirmPaid: jest.fn().mockResolvedValue(true), openDialog: jest.fn() };
    app = createFictionApp({ api, dialogs });
  });
  afterEach(() => { app.dispose(); jest.useRealTimers(); });
  test('preferences offer Off, Standard, Memory and Both without buying anything', async () => {
    await app.start(); document.getElementById('fictionPreferences').click(); const spec = dialogs.openDialog.mock.calls.at(-1)[0];
    const select = spec.body.flatMap((node) => [...node.querySelectorAll('select')]).find((node) => [...node.options].some((option) => option.value === 'both'));
    expect([...select.options].map((option) => option.value)).toEqual(['off', 'standard', 'memory', 'both']);
    select.value = 'memory'; await spec.actions.find((action) => action.label === 'Save preferences').onClick(jest.fn());
    expect(api).toHaveBeenCalledWith('/fiction/quality/preferences', 'PUT', expect.objectContaining({ quality_mode: 'memory' })); expect(dialogs.confirmPaid).not.toHaveBeenCalled();
  });
  test('review names both models, the total ceiling and private-context exposure; cancellation retains direction', async () => {
    await app.start(); dialogs.confirmPaid.mockResolvedValue(false); document.getElementById('fictionDirection').value = 'Stay in the garden.';
    await app.send('steer'); const spec = dialogs.confirmPaid.mock.calls[0][0];
    expect(spec.consentScope).toBe(`fiction-quality-${'a'.repeat(64)}`); expect(spec.review.quantity).toContain('6 model calls');
    expect(spec.review.model).toContain('standard-model'); expect(spec.review.model).toContain('memory-model'); expect(spec.review.sends).toContain('hidden truth');
    expect(document.getElementById('fictionDirection').value).toBe('Stay in the garden.'); expect(api.mock.calls.some(([, method]) => method === 'POST')).toBe(false);
  });
  test.each(['missing', 'unavailable', 'wrong-mode'])('a %s quality plan never silently purchases standard play', async (failure) => {
    const value = story(); if (failure === 'missing') delete value.quality_generation; else if (failure === 'unavailable') value.quality_generation.available = false; else value.quality_generation.mode = 'off';
    api.mockResolvedValue({ story: value }); await app.start(); await app.send('follow');
    expect(dialogs.confirmPaid).not.toHaveBeenCalled(); expect(api.mock.calls.some(([, method]) => method === 'POST')).toBe(false); expect(document.getElementById('fictionStatus').textContent).toContain('unavailable');
  });
  test('progress reads are free, duplicate submission is blocked, and late progress cannot cross lock', async () => {
    await app.start(); jest.useFakeTimers(); let complete; let progress;
    api.mockImplementation((path, method) => new Promise((resolve) => { if (method === 'POST') complete = resolve; else progress = resolve; }));
    const pending = app.send('follow'); await Promise.resolve(); await app.send('follow');
    expect(api.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
    expect(api.mock.calls.find(([, method]) => method === 'POST')[2].quality_review).toBe('a'.repeat(64));
    await jest.advanceTimersByTimeAsync(1500); progress({ story: { ...story(), pending: true, call_limit: 6, pending_stage: { purpose: 'review', role: 'archivist', call_index: 3 } } }); await Promise.resolve();
    expect(document.getElementById('fictionActionStatus').textContent).toContain('memory support · call 3 of at most 6');
    await jest.advanceTimersByTimeAsync(1500); app.lock(); progress({ story: { ...story(), pending: true, pending_stage: { purpose: 'repair', role: 'scribe', call_index: 4 } } });
    complete({ story: story() }); await pending; await jest.advanceTimersByTimeAsync(5000);
    expect(document.getElementById('fictionQualityState').textContent).toBe(''); expect(document.getElementById('fictionCalls').textContent).toBe(''); expect(document.getElementById('fictionActionStatus').textContent).not.toContain('Repairing');
    expect(api.mock.calls.filter(([, method]) => method === 'POST')).toHaveLength(1);
  });
  test('memory model configuration uses its own role and makes no generation request', async () => {
    api.mockResolvedValue({ profiles: [{ id: 'provider', display_name: 'Test', capabilities: ['chat'], credential: { state: 'ready' } }], roles: [{ role: 'archivist', profile_id: 'provider', model_id: 'old-memory' }], vault: { state: 'empty' } });
    const panel = createProviderPanel({ api }); await panel.render();
    const label = [...document.querySelectorAll('label')].find((node) => node.textContent === 'Memory-support model identifier'); document.getElementById(label.htmlFor).value = 'new-memory';
    [...document.querySelectorAll('button')].find((node) => node.textContent === 'Use this memory-support model').click(); await tick();
    expect(api).toHaveBeenCalledWith('/providers/roles/archivist', 'PUT', { profile_id: 'provider', model_id: 'new-memory' }); expect(api.mock.calls.some(([, method]) => method === 'POST')).toBe(false); panel.clear();
  });
  test('global one-call consent cannot authorise quality; different plans require separate review', async () => {
    const manager = createDialogManager(); window.localStorage.setItem('im-paid-consent-v1', '1');
    const spec = qualityPaidReview(story()); const first = manager.confirmPaid(spec); await tick();
    expect(document.querySelector('.dialog-manager').hidden).toBe(false); document.querySelector('.dialog-manager .btn-secondary').click(); expect(await first).toBe(false); expect(manager.hasPaidConsent(spec.consentScope)).toBe(false);
    const accepted = manager.confirmPaid(spec); document.querySelector('.dialog-manager .btn-primary').click(); expect(await accepted).toBe(true);
    expect(await manager.confirmPaid(spec)).toBe(true);
    const changed = manager.confirmPaid({ ...spec, consentScope: 'different-model-or-mode' }); expect(document.querySelector('.dialog-manager').hidden).toBe(false); document.querySelector('.dialog-manager .btn-secondary').click(); expect(await changed).toBe(false);
    const disabled = manager.confirmPaid({ ...spec, disabled: true }); document.querySelector('.dialog-manager .btn-secondary').click(); expect(await disabled).toBe(false);
  });
});
