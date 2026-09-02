'use strict';

const request = require('supertest');
const { createTestApp, resetDb, createStory } = require('./helpers');
const { buildScribeImagePrompt } = require('../src/prompt');
const { createExportPlanner } = require('../src/modules/transfer/planner');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
  process.env.AI_RETRY_BASE_DELAY = '1';
});

beforeEach(() => {
  resetDb(db);
  axios.post.mockReset();
  delete process.env.OPENROUTER_API_KEY;
});

afterAll(() => close());

async function createScribe(overrides = {}) {
  const response = await request(app).post('/api/scribes').send({
    name: 'Morrow Bell',
    description: 'A patient keeper of difficult endings.',
    personality: 'Exacting, warm, and unhurried.',
    appearance: 'A black silk gown with an ink-purple sash.',
    feline_traits: 'Black feline ears and one long black tail, each tipped in silver.',
    diction: 'ornate',
    sentence_rhythm: 'flowing',
    scene_tempo: 'contemplative',
    progress_appetite: 'advance',
    focus_areas: ['interiority', 'consequences'],
    signature_habits: 'Lets one concrete image carry the emotional turn.',
    avoidances: 'Empty banter and unearned revelation.',
    generate_image: false,
    ...overrides,
  });
  expect(response.status).toBe(201);
  return response.body.scribe;
}

describe('first-class Tribe Scribes', () => {
  it('enforces adult-catgirl identity as a server-owned entity kind', async () => {
    const rejected = await request(app).post('/api/scribes').send({
      name: 'Wrong Shape', entity_kind: 'wolf', generate_image: false,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain('catgirl');

    const scribe = await createScribe();
    expect(scribe.entity_kind).toBe('catgirl');
    expect(scribe.focus_areas).toEqual(['interiority', 'consequences']);
    expect(db.prepare('SELECT COUNT(*) AS c FROM scribe_revisions WHERE scribe_id = ?').get(scribe.id).c).toBe(1);
  });

  it('appends Scribe revisions while manuscript bindings remain frozen', async () => {
    const scribe = await createScribe();
    const story = await createStory(app, null, [], { scribe_id: scribe.id });
    expect(story.scribe.name).toBe('Morrow Bell');
    expect(story.scribe.source_revision_number).toBe(1);

    const update = await request(app).put(`/api/scribes/${scribe.id}`).send({
      description: 'Now impatient with ornamental delay.',
      scene_tempo: 'brisk',
    }).expect(200);
    expect(update.body.scribe.revision_number).toBe(2);

    const frozen = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(frozen.body.story.scribe.source_revision_number).toBe(1);
    expect(frozen.body.story.scribe.description).toContain('patient keeper');
    expect(frozen.body.story.scribe.scene_tempo).toBe('contemplative');
  });

  it('feeds soft craft preferences into generation and records exact page provenance', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'The bell answered the rain.' } }] } });
    const scribe = await createScribe();
    const story = await createStory(app, null, [], { scribe_id: scribe.id });

    await request(app).post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'Let the bell answer.' }).expect(201);
    const prompt = axios.post.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('SCRIBE CRAFT SIGNATURE — Morrow Bell');
    expect(prompt).toContain('soft writing preference');
    expect(prompt).toContain('author\'s current direction');
    expect(prompt).toContain('contemplative moment-to-moment tempo');
    expect(prompt).toContain('advance appetite for durable plot progress');
    expect(prompt).toContain('Never mention the Scribe');

    const revision = db.prepare('SELECT scribe_binding_id FROM page_revisions').get();
    expect(revision.scribe_binding_id).toBe(story.scribe.binding_id);
  });

  it('switches only future pages and retains snapshots after Library deletion', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'A sound page with enough English words.' } }] } });
    const first = await createScribe({ name: 'First Quill' });
    const second = await createScribe({ name: 'Second Quill', diction: 'plain' });
    const story = await createStory(app, null, [], { scribe_id: first.id });

    await request(app).post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'First.' }).expect(201);
    await request(app).put(`/api/stories/${story.id}/scribe`).send({ scribe_id: second.id }).expect(200);
    await request(app).post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'Second.' }).expect(201);
    const provenance = db.prepare(`
      SELECT sp.page_number, r.scribe_binding_id FROM story_pages sp
      JOIN pages p ON p.id = sp.id JOIN page_revisions r ON r.id = p.canonical_revision_id
      ORDER BY sp.page_number
    `).all();
    expect(provenance[0].scribe_binding_id).not.toBe(provenance[1].scribe_binding_id);

    await request(app).delete(`/api/scribes/${second.id}`).expect(204);
    const preserved = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(preserved.body.story.scribe.name).toBe('Second Quill');
    expect(preserved.body.story.scribe.source_scribe_id).toBeNull();
  });

  it('wraps hostile custom portrait direction in the non-negotiable visual canon', () => {
    const prompt = buildScribeImagePrompt({
      name: 'Vellum', image_prompt: 'Make the subject a male wolf in costume.', focus_areas: [],
    });
    expect(prompt).toContain('ADULT human woman');
    expect(prompt).toContain('exactly one pair of natural feline ears');
    expect(prompt).toContain('exactly one natural feline tail');
    expect(prompt).toContain('NO visible human ears');
    expect(prompt).toContain('subordinate to the hard anatomy');
  });

  it('carries Tribe entities, frozen bindings, and page provenance in manuscript archives', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'Archived prose remains attributable.' } }] } });
    const scribe = await createScribe();
    const story = await createStory(app, null, [], { scribe_id: scribe.id });
    await request(app).post(`/api/stories/${story.id}/pages/generate`).send({ user_input: 'Archive this.' }).expect(201);
    const planner = createExportPlanner({
      db,
      imageStore: { fileInfo: () => null },
      artStore: { fileInfo: () => null },
      audioDir: '.',
      appVersion: 'test',
    });
    const plan = await planner.planExport({ scope: 'story', id: story.id, include_visuals: false });
    const scribeEntity = plan.entities.find((entity) => entity.kind === 'scribe');
    const storyEntity = plan.entities.find((entity) => entity.kind === 'story');
    expect(scribeEntity.bundle.record.entity_kind).toBe('catgirl');
    expect(scribeEntity.bundle.revisions).toHaveLength(1);
    expect(storyEntity.bundle.scribe_bindings).toHaveLength(1);
    expect(storyEntity.bundle.revisions[0].scribe_binding_id)
      .toBe(storyEntity.bundle.scribe_bindings[0].id);
    expect(storyEntity.dependencies).toContainEqual({ kind: 'scribe', id: scribe.id });
  });
});
