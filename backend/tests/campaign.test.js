'use strict';

const request = require('supertest');
const { createTestApp, createCharacter, createStory } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');

describe('living campaign state', () => {
  let fixture;
  beforeEach(() => { fixture = createTestApp(); axios.post.mockReset(); axios.get.mockReset(); delete process.env.OPENROUTER_API_KEY; });
  afterEach(() => fixture.close());

  async function setup() {
    const lead = await createCharacter(fixture.app, null, { name: 'Mara' });
    const support = await createCharacter(fixture.app, null, { name: 'Bell' });
    const story = await createStory(fixture.app, null, [
      { id: lead.id, role: 'mc', relation: 'self', state: null },
      { id: support.id, role: 'supporting', relation: 'guide', state: null },
    ]);
    const chapter = story.hierarchy.volumes[0].chapters[0];
    const scene = (await request(fixture.app).post(`/api/stories/${story.id}/chapters/${chapter.id}/scenes`)
      .send({ title: 'The Stair', mode: 'play' }).expect(201)).body.scene;
    return { story, scene, lead, support };
  }

  it('keeps owner state revisioned, optional, and Main-first', async () => {
    const p = await setup();
    expect((await request(fixture.app).get(`/api/stories/${p.story.id}/campaign-state`).expect(200)).body.entries).toEqual([]);
    const supporting = (await request(fixture.app).post(`/api/stories/${p.story.id}/campaign-state`).send({
      kind: 'debt', title: 'Bell owes the keeper', details: { summary: 'One safe passage.' },
      subject_character_id: p.support.id, visibility: 'secret', source_type: 'author',
    }).expect(201)).body.entry;
    const main = (await request(fixture.app).post(`/api/stories/${p.story.id}/campaign-state`).send({
      kind: 'promise', title: 'Mara will return', details: { summary: 'Before the third bell.' },
      subject_character_id: p.lead.id, source_type: 'author',
    }).expect(201)).body.entry;
    expect(main.priority).toBeUndefined();
    const list = (await request(fixture.app).get(`/api/stories/${p.story.id}/campaign-state`).expect(200)).body.entries;
    expect(list.map((entry) => entry.id)).toEqual([main.id, supporting.id]);
    expect(list.map((entry) => entry.priority)).toEqual([0, 1]);
    const revised = (await request(fixture.app).put(`/api/stories/${p.story.id}/campaign-state/${main.id}`).send({
      title: 'Mara returned', status: 'resolved', details: { state: 'kept' }, source_type: 'author',
    }).expect(200)).body.entry;
    expect(revised).toMatchObject({ revision_number: 2, status: 'resolved', details: { summary: 'Before the third bell.', state: 'kept' } });
    expect(fixture.db.prepare('SELECT COUNT(*) AS c FROM campaign_entry_revisions WHERE entry_id = ?').get(main.id).c).toBe(2);
    await request(fixture.app).delete(`/api/stories/${p.story.id}/campaign-state/${supporting.id}`).expect(204);
  });

  it('returns transcript-bound AI proposals without applying them and replays idempotently', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const p = await setup();
    const session = (await request(fixture.app).post(`/api/stories/${p.story.id}/scenes/${p.scene.id}/play-sessions`).send({
      participants: [{ character_id: p.lead.id, controller: 'owner' }, { character_id: p.support.id, controller: 'scribe' }],
      scribe_initiative: 'balanced', challenge: 'balanced', pacing: 'balanced', consequences: 'meaningful',
      allow_character_death: false, suggestions: 'on_request', player_interiority: 'owner_only',
    }).expect(201)).body.session;
    const turn = (await request(fixture.app).post(`/api/stories/${p.story.id}/play-sessions/${session.id}/turns`)
      .send({ kind: 'say', character_id: p.lead.id, content: 'I promise Bell I will return before dawn.' }).expect(201)).body.turn;
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify({ proposals: [{
      kind: 'promise', title: 'Return before dawn', summary: 'Mara promised Bell she would return.', state: 'open',
      subject_character_id: p.lead.id, related_character_id: p.support.id, visibility: 'public', known_by: [p.lead.id, p.support.id],
      witnesses: [p.support.id], source_turn_id: turn.id, evidence_quote: 'I promise Bell I will return before dawn.',
    }] }) } }] } });
    const endpoint = `/api/stories/${p.story.id}/scenes/${p.scene.id}/campaign-suggestions`;
    const first = await request(fixture.app).post(endpoint).set('Idempotency-Key', 'state-1').send({}).expect(201);
    expect(first.body.proposals[0]).toMatchObject({ kind: 'promise', source_type: 'play_turn', source_id: turn.id });
    expect((await request(fixture.app).get(`/api/stories/${p.story.id}/campaign-state`)).body.entries).toEqual([]);
    const replay = await request(fixture.app).post(endpoint).set('Idempotency-Key', 'state-1').send({}).expect(200);
    expect(replay.body.reused).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
    await request(fixture.app).post(`/api/stories/${p.story.id}/campaign-state`).send(first.body.proposals[0]).expect(201);
    const recap = (await request(fixture.app).get(`/api/stories/${p.story.id}/scenes/${p.scene.id}/recap`).expect(200)).body.recap;
    expect(recap.entries[0]).toMatchObject({ title: 'Return before dawn', priority: 0, source: { id: turn.id } });
  });
});
