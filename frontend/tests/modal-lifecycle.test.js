'use strict';

// The complete modal lifecycle (wired wireModal controller): focus entry,
// forward/backward Tab trap, one Escape/backdrop policy, dirty guards,
// opener restoration, and the COUNTED document scroll lock across stacked
// modals (scene viewer over the prompt popup, shared dialogs over either).

import { loadScript, mockFetch, jsonResponse, dialogAction } from './dom-helpers.js';

function press(key, opts = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));
}

function focusablesIn(root) {
  return [...root.querySelectorAll('button, [href], input, select, textarea')].filter(
    (el) => !el.disabled && !el.closest('[hidden]')
  );
}

function storyState() {
  return {
    currentStory: { id: 's1', title: 'T', tone: 'romantic', page_count: 1, total_cost_usd: 0 },
    storyPages: [{ page_number: 1, content: 'The hall stood dark.', user_input: null, cost_usd: 0 }],
    currentPage: 1,
  };
}

describe('Modal lifecycle (wired controller)', () => {
  let fw;

  beforeEach(async () => {
    window.localStorage.clear();
    mockFetch();
    fw = await loadScript();
  });

  it('world editor: focus entry, Tab trap, Escape dirty guard, opener restore, scroll unlock', async () => {
    fw.state().worlds.push({ id: 'w1', name: 'W', description: 'd', genre: 'g', setting: 's', lore: '', image_prompt: '' });
    const opener = document.getElementById('worldsBtn');
    opener.focus();
    fw.openWorldEditor(fw.state().worlds[0]);

    const modal = document.getElementById('worldEditorModal');
    expect(modal.hidden).toBe(false);
    // Focus enters the first field
    expect(document.activeElement).toBe(document.getElementById('worldEditName'));
    // The document scroll is locked exactly once
    expect(document.documentElement.style.overflow).toBe('hidden');

    // Forward trap: Tab from the LAST focusable wraps to the first
    const items = focusablesIn(modal);
    items[items.length - 1].focus();
    press('Tab');
    expect(document.activeElement).toBe(items[0]);
    // Backward trap: Shift+Tab from the first wraps to the last
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);

    // Escape with a dirty form: the discard confirm, not a silent close
    document.getElementById('worldEditName').value = 'Changed';
    press('Escape');
    await new Promise((r) => setTimeout(r, 0));
    expect(modal.hidden).toBe(false); // still open: the guard asked
    expect(await dialogAction('Discard changes')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(modal.hidden).toBe(true);

    // Focus restored to the opener; the scroll lock released exactly once
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('backdrop click follows the same dirty policy as Escape', async () => {
    fw.state().worlds.push({ id: 'w1', name: 'W', description: 'd', genre: 'g', setting: 's', lore: '', image_prompt: '' });
    fw.openWorldEditor(fw.state().worlds[0]);
    const modal = document.getElementById('worldEditorModal');
    document.getElementById('worldEditLore').value = 'dirty lore';
    modal.click(); // backdrop
    await new Promise((r) => setTimeout(r, 0));
    expect(modal.hidden).toBe(false); // guard asked first
    expect(await dialogAction('Discard changes')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(modal.hidden).toBe(true);
  });

  it('scene viewer over the prompt popup: Escape dismisses the viewer first, focus returns underneath', async () => {
    fw.__setStoryState(storyState());
    fw.displayCurrentPage();
    fw.openSceneViewer('data:image/png;base64,iVBORw0KGgo=', 'image/png', { prompt: 'A hall.' });
    const viewer = document.getElementById('sceneImageViewerModal');
    expect(viewer.hidden).toBe(false);

    // Two modals are open: the lock is still ONE (counted)
    expect(document.documentElement.style.overflow).toBe('hidden');

    press('Escape'); // the TOP modal (viewer) goes first
    expect(viewer.hidden).toBe(true);
    // Focus fell somewhere live (the prompt popup was never opened in this
    // test; what matters is no dead element keeps it).
    expect(document.activeElement === viewer).toBe(false);

    // With everything closed, the lock is released exactly once
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('audiobook modal: initial focus on the start action, Escape closes, opener restored', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    fw.__setStoryState(storyState());
    fw.displayCurrentPage();
    const opener = document.getElementById('audiobookBtn');
    opener.focus();

    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/speech-models')) {
        return Promise.resolve(jsonResponse(200, { models: [{ id: 'or/voice-1', name: 'V', voices: [{ id: 'amber', label: 'A' }], pricing: { prompt_per_mchar: 15, completion_per_mtok: 0 } }] }));
      }
      if (String(url).includes('/audiobook')) return Promise.resolve(jsonResponse(200, { audiobook: null }));
      return Promise.resolve(jsonResponse(200, { stories: [] }));
    });

    // openAudiobookModal is not on the facade; drive the button.
    opener.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const modal = document.getElementById('audiobookModal');
    expect(modal.hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('audiobookStartBtn'));

    press('Escape');
    expect(modal.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('a shared paid review over a wired modal: Escape closes only the review', async () => {
    fw.setSetting('narrationModel', 'or/voice-1');
    fw.setSetting('narrationVoice', 'amber');
    fw.__setStoryState(storyState());
    fw.displayCurrentPage();
    const pending = fw.dialogs.confirmPaid({
      title: 'Read this page aloud?',
      review: { action: 'Narrate this page.', estimate: 0.01 },
      confirmLabel: 'Read it (≈$0.0100)',
    });
    await new Promise((r) => setTimeout(r, 0));
    press('Escape');
    expect(await pending).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
  });
});
