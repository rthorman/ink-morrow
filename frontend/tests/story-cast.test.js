'use strict';

const { loadScript, mockFetch, jsonResponse } = require('./dom-helpers');

const CHARACTERS = [
  { id: 'mc1', name: 'The Lead', world_id: 'w1', description: 'A haunted knight', personality: 'Steadfast and cold', appearance: 'Grey cloak, tired eyes', background: 'A former guard' },
  { id: 'ally1', name: 'The Ally', world_id: 'w1', description: 'A cheerful smuggler', personality: 'Chatty and brave', appearance: 'Red scarf', background: 'Owes everyone money' },
  { id: 'outsider', name: 'The Stranger', world_id: 'w2', description: 'From another world', personality: 'Quiet', appearance: 'Unremarkable', background: 'Unknown' },
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

function members() {
  return [...document.querySelectorAll('.cast-edit-member')];
}

// The in-story sheet fields render in CAST_EDIT_FIELDS order per member
function sheetFields(member) {
  return [...member.querySelectorAll('.cast-edit-member__sheet textarea')];
}

describe('Story cast editor', () => {
  let fw;

  beforeEach(() => {
    mockFetch([
      { match: '/api/characters', response: jsonResponse(200, { characters: CHARACTERS }) },
      { match: '/api/worlds', response: jsonResponse(200, { worlds: [] }) },
      { match: '/api/stories/s1', response: jsonResponse(200, { story: STORY }) },
      { match: '/api/stories', response: jsonResponse(200, { stories: [{ ...STORY, page_count: 3, total_cost_usd: 0 }] }) },
    ]);
    fw = loadScript();
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
    expect(members()).toHaveLength(2);
  });

  it('exposes the in-story sheets as they stand, with the base sheets as hints', async () => {
    await openEditor(fw);
    const [mc, ally] = members();
    expect(mc.querySelector('.cast-list__name').textContent).toBe('The Lead');
    expect(mc.querySelector('.cast-edit-member__role').value).toBe('mc');
    expect(mc.querySelector('.cast-edit-member__relation')).toBeNull(); // the Lead has no tie to themselves

    // The MC's in-story personality, exactly as the tale wrote it; the base sheet is only the hint
    const [mcPersonality, mcAppearance] = sheetFields(mc);
    expect(mcPersonality.value).toBe('Colder now, hungrier');
    expect(mcPersonality.placeholder).toContain('Steadfast and cold');
    expect(mcAppearance.value).toBe(''); // not yet reshaped by the tale
    expect(mcAppearance.placeholder).toContain('Grey cloak, tired eyes');

    // The ally: empty state, base hints, and the seeded relation
    const [allyPersonality] = sheetFields(ally);
    expect(allyPersonality.value).toBe('');
    expect(allyPersonality.placeholder).toContain('Chatty and brave');
    expect(ally.querySelector('.cast-edit-member__relation').value).toBe('owes the Lead a life-debt');
  });

  it('adds a new member with role and relation; the sheet starts empty', async () => {
    await openEditor(fw);
    document.getElementById('storyCastAddSelect').value = 'outsider';
    document.getElementById('storyCastAddRole').value = 'background';
    document.getElementById('storyCastAddRelation').value = 'a shadow from another world';
    document.getElementById('storyCastAddBtn').click();

    const third = members()[2];
    expect(third.querySelector('.cast-list__name').textContent).toBe('The Stranger');
    expect(third.querySelector('.cast-edit-member__role').value).toBe('background');
    expect(third.querySelector('.cast-edit-member__relation').value).toBe('a shadow from another world');
    // Add-row reset: the picker no longer offers the Stranger
    expect([...document.getElementById('storyCastAddSelect').options].some((o) => o.value === 'outsider')).toBe(false);
  });

  it('removes a member from the running cast', async () => {
    await openEditor(fw);
    members()[1].querySelector('.cast-list__remove').click();
    expect(members()).toHaveLength(1);
    expect(fw.__castEditState().entries.map((e) => e.id)).toEqual(['mc1']);
  });

  it('promoting a new Main Character demotes the old one', async () => {
    await openEditor(fw);
    const role = members()[1].querySelector('.cast-edit-member__role');
    role.value = 'mc';
    role.dispatchEvent(new Event('change', { bubbles: true }));
    const state = fw.__castEditState();
    expect(state.entries.find((e) => e.id === 'mc1').role).toBe('supporting');
    expect(state.entries.find((e) => e.id === 'ally1').role).toBe('mc');
  });

  it('removing the Main Character is allowed, with an honest warning', async () => {
    await openEditor(fw);
    members()[0].querySelector('.cast-list__remove').click();
    expect(members()).toHaveLength(1);
    const note = document.getElementById('storyCastNote');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('No Main Character');
  });

  it('saves the whole cast with edited sheets intact and untouched state preserved', async () => {
    await openEditor(fw);
    const appearance = sheetFields(members()[1])[1]; // the ally's in-story appearance
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
