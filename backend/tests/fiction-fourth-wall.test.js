'use strict';

const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');
const { createFictionSaves, validateSave } = require('../src/modules/fiction/saves');
const { fourthWallContext } = require('../src/modules/fiction/fourth-wall');
const { gunzipSync } = require('node:zlib');

describe('Living-world character fourth-wall permission', () => {
  let db; let store; let story; let service; let completion; let requestNumber;
  const follow = { kind: 'follow', text: '' };
  const ordinary = { prose: 'Jo sets the kettle beside the seedlings.', summary: 'A moment in the garden.', effects: [] };
  const aside = { character_id: 'jo', text: 'You can probably see where this is going, dear reader.' };
  const output = (extra = {}) => completion.mockResolvedValue({ content: JSON.stringify({ ...ordinary, ...extra }), billed_attempts: 1, cost_usd: 0.01 });
  const reply = async (input = follow) => {
    const result = await service.reply({ gameId: story.id, expectedRevision: store.view(story.id).revision, idempotencyKey: `fourth-${++requestNumber}`, input });
    story = result.story; return result;
  };
  beforeEach(() => {
    db = createDb(':memory:'); store = createFictionStore(db); requestNumber = 0;
    story = store.create({ scenario_id: 'garden-after-rain', play_style: 'living-world' });
    completion = jest.fn(); output(); service = createFictionService({ store, chatCompletion: completion });
  });
  afterEach(() => db.close());

  test('defaults to Never and validates settings before any purchase', () => {
    expect(story.state.fourth_wall).toBe('never');
    expect(() => store.preferences(story.id, story.revision, { fourth_wall: 'always' })).toThrow('not supported');
    expect(() => store.create({ scenario_id: 'garden-after-rain', fourth_wall: 'always' })).toThrow('not supported');
    expect(completion).not.toHaveBeenCalled();
  });
  test('Never rejects a structured aside atomically and retains its actual charge', async () => {
    const before = store.current(story.id); output({ aside });
    await expect(reply()).rejects.toMatchObject({ code: 'FOURTH_WALL_NOT_ALLOWED', billedAttempts: 1, costUsd: 0.01 });
    expect(store.current(story.id)).toEqual(before); expect(completion).toHaveBeenCalledTimes(1);
    expect(store.view(story.id).spend.known_usd).toBe(0.01);
  });
  test('Freely permits consecutive optional addresses, without requiring one', async () => {
    story = store.preferences(story.id, story.revision, { fourth_wall: 'freely' }); output({ aside });
    await reply(); await reply();
    expect(story.beats.at(-1).prose).toContain('Jo, to you:'); expect(story.beats.at(-1).prose).toContain(aside.text);
    expect(story.state.last_fourth_wall_scene).toBe(2);
    const prompt = JSON.parse(completion.mock.calls.at(-1)[0][1].content);
    expect(prompt.fourth_wall).toMatchObject({ mode: 'freely', allowed: true });
    output(); await reply(); expect(story.state.last_fourth_wall_scene).toBe(2);
  });
  test('Rarely requires five intervening narrated passages and failed attempts do not shorten the gap', async () => {
    story = store.preferences(story.id, story.revision, { fourth_wall: 'rarely' }); output({ aside }); await reply();
    await expect(reply()).rejects.toMatchObject({ code: 'FOURTH_WALL_NOT_ALLOWED' });
    expect(store.current(story.id).state.scene_count).toBe(1);
    output(); for (let i = 0; i < 5; i++) await reply();
    output({ aside }); await reply(); expect(story.state.last_fourth_wall_scene).toBe(7);
    expect(completion).toHaveBeenCalledTimes(8);
  });
  test('Story-shaping and outside-story Ask do not enable character asides', async () => {
    story = store.preferences(story.id, story.revision, { fourth_wall: 'freely', play_style: 'story-shaping' }); output({ aside });
    await expect(reply()).rejects.toMatchObject({ code: 'FOURTH_WALL_NOT_ALLOWED' });
    story = store.preferences(story.id, story.revision, { play_style: 'living-world' });
    await expect(reply({ kind: 'ask', text: 'Who is Jo?' })).rejects.toMatchObject({ code: 'FOURTH_WALL_NOT_ALLOWED' });
    expect(store.current(story.id).state.scene_count).toBe(0);
  });
  test('the narrator cannot use fourth-wall permission to speak for an inhabited or unknown character', async () => {
    story = store.preferences(story.id, story.revision, { fourth_wall: 'freely' });
    story = store.control(story.id, story.revision, 'jo'); output({ aside });
    await expect(reply()).rejects.toMatchObject({ code: 'OWNED_CHARACTER_BOUNDARY' });
    output({ aside: { ...aside, character_id: 'invented' } });
    await expect(reply()).rejects.toMatchObject({ code: 'OWNED_CHARACTER_BOUNDARY' });
    expect(store.current(story.id).state.control.character_id).toBe('jo');
  });
  test('an aside is not evidence for a world-state change', async () => {
    story = store.preferences(story.id, story.revision, { fourth_wall: 'freely' });
    output({ aside, effects: [{ op: 'remember', fact: { id: 'invented', text: 'The reader gave Jo a key.' }, evidence: aside.text }] });
    await expect(reply()).rejects.toThrow('no direct evidence');
    expect(store.current(story.id).state.last_fourth_wall_scene).toBeNull();
    expect(store.current(story.id).state.facts.some((fact) => fact.id === 'invented')).toBe(false);
  });
  test('reload, fork and save-copy preserve settings and the branch-local cooldown', async () => {
    const opening = story.head_beat_id; const original = story.active_branch_id;
    story = store.preferences(story.id, story.revision, { fourth_wall: 'rarely' }); output({ aside }); await reply();
    const reloaded = createFictionStore(db).view(story.id);
    expect(reloaded.state).toMatchObject({ fourth_wall: 'rarely', last_fourth_wall_scene: 1 });
    story = store.fork(story.id, story.revision, { name: 'Before asides', beat_id: opening });
    expect(story.state).toMatchObject({ fourth_wall: 'never', last_fourth_wall_scene: null });
    story = store.selectBranch(story.id, story.revision, original);
    const saves = createFictionSaves({ db, store, media: {} }); const packed = await saves.exportSave(story.id);
    const restored = await saves.importSave(packed);
    expect(restored.state).toMatchObject({ fourth_wall: 'rarely', last_fourth_wall_scene: 1 });
    expect(fourthWallContext(restored.state, follow).allowed).toBe(false);
    expect(restored.beats.at(-1).prose).toContain(aside.text);
    const invalid = JSON.parse(gunzipSync(packed)); invalid.beats.at(-1).state.last_fourth_wall_scene = 99;
    expect(() => validateSave(invalid)).toThrow('fourth-wall scene');
  });
});
