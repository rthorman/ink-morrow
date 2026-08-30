'use strict';

import { loadScript, mockFetch, jsonResponse } from './dom-helpers.js';

const CHARACTERS = [
  { id: 'mc1', name: 'The Lead', world_id: 'w1', description: 'A haunted knight', personality: 'Steadfast and cold', appearance: 'Grey cloak, tired eyes', background: 'A former guard' },
  { id: 'ally1', name: 'The Ally', world_id: 'w1', description: 'A cheerful smuggler', personality: 'Chatty and brave', appearance: 'Red scarf', background: 'Owes everyone money' },
  { id: 'outsider', name: 'The Stranger', world_id: 'w2', description: 'From another world', personality: 'Quiet', appearance: 'Unremarkable', background: 'Unknown' },
  { id: 'witness', name: 'The Witness', world_id: 'w2', description: 'Always nearby', personality: 'Watchful', appearance: 'Ink-stained gloves', background: 'Records what others forget' },
];

const STORY = {
  id: 's1',
  title: 'The Running Tale',
  world_id: 'w1',
  tone: 'romantic',
  characters: [
    { id: 'mc1', role: 'mc', relation: null, state: { personality: 'Colder now, hungrier' } },
    { id: 'ally1', role: 'supporting', relation: 'owes the Lead a life-debt', state: null },
  ],
};

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

async function openEditor(fw) {
  await fw.openStoryCastEditor(STORY);
  await flush();
}

function rosterRows() {
  return [...document.querySelectorAll('#storyCastList .cast-edit-member__row')];
}

function detail() {
  return document.getElementById('storyCastDetail');
}

function selectMember(fw, id) {
  rosterRows().find((row) => row.textContent.includes(id === 'mc1' ? 'The Lead' : id === 'ally1' ? 'The Ally' : 'The Stranger')).querySelector('.cast-edit-member__select').click();
}

function sheetFields() {
  return [...detail().querySelectorAll('.cast-edit-member__sheet textarea')];
}

describe('Story cast editor', () => {
  let fw;

  beforeEach(async () => {
    mockFetch([
      { match: '/api/characters', response: jsonResponse(200, { characters: CHARACTERS }) },
      { match: '/api/worlds', response: jsonResponse(200, { worlds: [] }) },
      { match: '/api/stories/s1', response: jsonResponse(200, { story: STORY }) },
      { match: '/api/stories', response: jsonResponse(200, { stories: [{ ...STORY, page_count: 3, total_cost_usd: 0 }] }) },
    ]);
    fw = await loadScript();
    fw.__setStoryState({ currentStory: null, storyPages: [], currentPage: 1 });
  });

  it('opens from a story card on the Stories page', async () => {
    await flush(); // the story list loads async on boot
    fw.renderStories();
    const cards = document.querySelectorAll('#storiesList .item-card');
    expect(cards).toHaveLength(1);
    cards[0].querySelector('.card-cast').click();
    await flush();
    expect(document.getElementById('storyCastModal').hidden).toBe(false);
    expect(rosterRows()).toHaveLength(2);
    // The header names the cast shape
    expect(document.getElementById('storyCastMode').textContent).toContain('Centered on The Lead');
  });

  it('exposes the in-story sheets as they stand, with the base sheets as hints', async () => {
    await openEditor(fw);
    // The first member is selected by default; their sheet shows the tale's truth
    expect(detail().querySelector('h3').textContent).toBe('The Lead');
    const [mcPersonality, mcAppearance] = sheetFields();
    expect(mcPersonality.value).toBe('Colder now, hungrier');
    expect(mcPersonality.placeholder).toContain('Steadfast and cold');
    expect(mcAppearance.value).toBe(''); // not yet reshaped by the tale
    expect(mcAppearance.placeholder).toContain('Grey cloak, tired eyes');
    // The lead has no tie to themselves
    expect([...detail().querySelectorAll('input')].filter((i) => i.type === 'text')).toHaveLength(0);

    // The ally: seeded relation, base hints, and a context-sensitive label
    selectMember(fw, 'ally1');
    const relation = detail().querySelector('input[type="text"]');
    expect(relation.value).toBe('owes the Lead a life-debt');
    expect(relation.previousSibling.textContent).toContain('Tie to The Lead');
    const [allyPersonality] = sheetFields();
    expect(allyPersonality.value).toBe('');
    expect(allyPersonality.placeholder).toContain('Chatty and brave');
  });

  it('shows cross-world provenance in the roster', async () => {
    await openEditor(fw);
    document.getElementById('storyCastAddSelect').value = 'outsider';
    document.getElementById('storyCastAddBtn').click();
    const strangerRow = rosterRows()[2];
    expect(strangerRow.textContent).toContain('The Stranger');
    expect(strangerRow.textContent).toContain('other world');
  });

  it('adds both supporting and background members with their chosen roles', async () => {
    await openEditor(fw);
    document.getElementById('storyCastAddSelect').value = 'outsider';
    document.getElementById('storyCastAddRole').value = 'supporting';
    document.getElementById('storyCastAddRelation').value = 'a shadow from another world';
    document.getElementById('storyCastAddBtn').click();

    expect(rosterRows()).toHaveLength(3);
    expect(detail().querySelector('h3').textContent).toBe('The Stranger');
    expect(detail().querySelector('select').value).toBe('supporting');
    expect(detail().querySelector('input[type="text"]').value).toBe('a shadow from another world');
    // Add-row reset: the picker no longer offers the Stranger
    expect([...document.getElementById('storyCastAddSelect').options].some((o) => o.value === 'outsider')).toBe(false);

    document.getElementById('storyCastAddSelect').value = 'witness';
    document.getElementById('storyCastAddRole').value = 'background';
    document.getElementById('storyCastAddRelation').value = 'records the tale from the gallery';
    document.getElementById('storyCastAddBtn').click();

    expect(rosterRows()).toHaveLength(4);
    expect(detail().querySelector('h3').textContent).toBe('The Witness');
    expect(detail().querySelector('select').value).toBe('background');
    expect(fw.__castEditState().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'outsider', role: 'supporting', relation: 'a shadow from another world' }),
      expect.objectContaining({ id: 'witness', role: 'background', relation: 'records the tale from the gallery' }),
    ]));
  });

  it('an empty cast can add a lead directly - never add-then-promote', async () => {
    mockFetch([
      { match: '/api/characters', response: jsonResponse(200, { characters: CHARACTERS }) },
      { match: '/api/worlds', response: jsonResponse(200, { worlds: [] }) },
      { match: '/api/stories/s1', response: jsonResponse(200, { story: { ...STORY, characters: [] } }) },
      { match: '/api/stories', response: jsonResponse(200, { stories: [] }) },
    ]);
    fw = await loadScript();
    await openEditor(fw);
    expect(rosterRows()).toHaveLength(0);
    // The Lead option is enabled when no lead exists
    expect(document.getElementById('storyCastAddRole').querySelector('option[value="mc"]').disabled).toBe(false);
    document.getElementById('storyCastAddSelect').value = 'mc1';
    document.getElementById('storyCastAddRole').value = 'mc';
    document.getElementById('storyCastAddBtn').click();
    const state = fw.__castEditState();
    expect(state.entries).toEqual([{ id: 'mc1', role: 'mc', relation: null, state: null }]);
    expect(document.getElementById('storyCastMode').textContent).toContain('Centered on The Lead');
  });

  it('removes a member from the running cast', async () => {
    await openEditor(fw);
    rosterRows()[1].querySelector('.cast-list__remove').click();
    expect(rosterRows()).toHaveLength(1);
    expect(fw.__castEditState().entries.map((e) => e.id)).toEqual(['mc1']);
  });

  it('promoting a new lead demotes the old one - via the direct Make lead action', async () => {
    await openEditor(fw);
    selectMember(fw, 'ally1');
    [...detail().querySelectorAll('button')].find((b) => b.textContent === 'Make lead').click();
    const state = fw.__castEditState();
    expect(state.entries.find((e) => e.id === 'mc1').role).toBe('supporting');
    expect(state.entries.find((e) => e.id === 'ally1').role).toBe('mc');
    expect(document.getElementById('storyCastMode').textContent).toContain('Centered on The Ally');
  });

  it('role changes keep local edits and focus (no full-pane rebuild)', async () => {
    await openEditor(fw);
    selectMember(fw, 'ally1');
    const relation = detail().querySelector('input[type="text"]');
    relation.focus();
    relation.value = 'sworn shield now';
    relation.dispatchEvent(new Event('input', { bubbles: true }));
    // Change the role while dirty: the pane is NOT rebuilt, so focus and the
    // draft survive.
    const roleSelect = detail().querySelector('select');
    roleSelect.value = 'background';
    roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    // Focus stays on the (rebuilt) relation field with the draft intact
    expect(document.activeElement.tagName).toBe('INPUT');
    expect(document.activeElement.value).toBe('sworn shield now');
    expect(detail().contains(document.activeElement)).toBe(true);
    expect(fw.__castEditState().entries.find((e) => e.id === 'ally1').relation).toBe('sworn shield now');
    expect(fw.__castEditState().entries.find((e) => e.id === 'ally1').role).toBe('background');
  });

  it('removing the lead is allowed, with an honest ensemble warning', async () => {
    await openEditor(fw);
    rosterRows()[0].querySelector('.cast-list__remove').click();
    expect(rosterRows()).toHaveLength(1);
    const note = document.getElementById('storyCastNote');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('ensemble');
    expect(document.getElementById('storyCastMode').textContent).toContain('Ensemble');
  });

  it('a dirty editor guards its close; discarding really discards', async () => {
    await openEditor(fw);
    selectMember(fw, 'ally1');
    const relation = detail().querySelector('input[type="text"]');
    relation.value = 'a new tie';
    relation.dispatchEvent(new Event('input', { bubbles: true }));

    document.getElementById('storyCastCancelBtn').click();
    await flush();
    // The discard confirmation opened INSTEAD of closing
    const dialog = document.querySelector('.dialog-manager');
    expect(dialog.querySelector('.dialog-manager__title').textContent).toContain('Discard');
    expect(document.getElementById('storyCastModal').hidden).toBe(false);
    // Keep editing: the draft survives
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
    await flush();
    expect(fw.__castEditState().entries.find((e) => e.id === 'ally1').relation).toBe('a new tie');
  });

  it('saves the whole cast with edited sheets intact and untouched state preserved', async () => {
    await openEditor(fw);
    selectMember(fw, 'ally1');
    const appearance = sheetFields()[1]; // the ally's in-story appearance
    appearance.value = 'Scarred, scarf burned';
    appearance.dispatchEvent(new Event('input', { bubbles: true }));

    document.getElementById('storyCastAddSelect').value = 'outsider';
    document.getElementById('storyCastAddBtn').click();
    document.getElementById('storyCastSaveBtn').click();
    await flush();

    const call = global.fetch.mock.calls.find(([url, options]) => String(url).endsWith('/stories/s1') && options.method === 'PUT');
    expect(JSON.parse(call[1].body).characters).toEqual([
      { id: 'mc1', role: 'mc', relation: null, state: { personality: 'Colder now, hungrier' } },
      { id: 'ally1', role: 'supporting', relation: 'owes the Lead a life-debt', state: { appearance: 'Scarred, scarf burned' } },
      { id: 'outsider', role: 'supporting', relation: null, state: null },
    ]);
    expect(document.getElementById('storyCastModal').hidden).toBe(true);
    expect(document.querySelector('.success-message').textContent).toContain('The Running Tale');
  });

  it('refreshes an open reader after a save without touching its pages', async () => {
    fw.__setStoryState({
      currentStory: { id: 's1', title: 'The Running Tale', tone: 'romantic', page_count: 3, total_cost_usd: 0.5 },
      storyPages: [
        { page_number: 1, content: 'One.', user_input: null, cost_usd: 0 },
        { page_number: 2, content: 'Two.', user_input: null, cost_usd: 0 },
      ],
      currentPage: 2,
    });
    await openEditor(fw);
    document.getElementById('storyCastSaveBtn').click();
    await flush();

    // The story pointer is the refreshed entry (totals from the server list)
    expect(fw.state().currentStory.id).toBe('s1');
    expect(fw.state().costs.story).toBeCloseTo(0); // base refreshed from the reloaded list
    // Pages and position survive untouched
    expect(fw.state().storyPages).toHaveLength(2);
    expect(fw.state().currentPage).toBe(2);
  });

  it('a refused save surfaces above the open modal and restores the button', async () => {
    await openEditor(fw);
    // The server rejects this cast (e.g. a race made two leads)
    global.fetch.mockImplementation((url, options) => {
      if (String(url).includes('/stories/s1') && options.method === 'PUT') {
        return Promise.resolve(jsonResponse(400, { error: 'A story can follow only one main character. Move the others to supporting or background.' }));
      }
      if (String(url).includes('/stories/s1')) return Promise.resolve(jsonResponse(200, { story: STORY }));
      if (String(url).includes('/api/stories')) return Promise.resolve(jsonResponse(200, { stories: [] }));
      if (String(url).includes('/api/characters')) return Promise.resolve(jsonResponse(200, { characters: CHARACTERS }));
      if (String(url).includes('/api/worlds')) return Promise.resolve(jsonResponse(200, { worlds: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    });

    document.getElementById('storyCastSaveBtn').click();
    await flush();
    expect(document.getElementById('storyCastModal').hidden).toBe(false);
    const floating = document.querySelector('.error-message');
    expect(floating.textContent).toContain('one main character');
    expect(floating.classList.contains('message--floating')).toBe(true);
    const btn = document.getElementById('storyCastSaveBtn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Save cast');
  });
});
