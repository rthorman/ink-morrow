'use strict';

const request = require('supertest');
const { createTestApp, createCharacter, createStory } = require('./helpers');

describe('deterministic solo-RPG tools', () => {
  let fixture;
  beforeEach(() => { fixture = createTestApp(); });
  afterEach(() => fixture.close());

  async function setup() {
    const lead = await createCharacter(fixture.app, null, { name: 'Mara' });
    const story = await createStory(fixture.app, null, [{ id: lead.id, role: 'mc', relation: 'self', state: null }]);
    const chapter = story.hierarchy.volumes[0].chapters[0];
    const scene = (await request(fixture.app).post(`/api/stories/${story.id}/chapters/${chapter.id}/scenes`)
      .send({ title: 'The Crossing', mode: 'play' }).expect(201)).body.scene;
    const session = (await request(fixture.app).post(`/api/stories/${story.id}/scenes/${scene.id}/play-sessions`).send({
      participants: [{ character_id: lead.id, controller: 'owner' }],
      scribe_initiative: 'balanced', challenge: 'balanced', pacing: 'balanced', consequences: 'meaningful',
      allow_character_death: false, suggestions: 'on_request', player_interiority: 'owner_only',
    }).expect(201)).body.session;
    return { lead, story, scene, session };
  }

  async function makeTool(parts, body) {
    return (await request(fixture.app).post(`/api/stories/${parts.story.id}/solo-tools`).send(body).expect(201)).body.tool;
  }

  async function run(parts, tool, input = {}) {
    return request(fixture.app).post(`/api/stories/${parts.story.id}/play-sessions/${parts.session.id}/tool-results`)
      .send({ tool_id: tool.id, input }).expect(201);
  }

  it('records local dice, oracle, table, deck, fields, and clock results without provider work', async () => {
    const parts = await setup();
    const dice = await makeTool(parts, { kind: 'dice', name: 'Risk', config: { notation: '2d6+1' } });
    const oracle = await makeTool(parts, { kind: 'oracle', name: 'Likely?', config: { chance: 70 } });
    const table = await makeTool(parts, { kind: 'table', name: 'Weather', config: { entries: [{ label: 'Rain', weight: 2 }, { label: 'Fog', weight: 1 }] } });
    const deck = await makeTool(parts, { kind: 'deck', name: 'Signs', config: { cards: ['Ash', 'Bell'] } });
    const fields = await makeTool(parts, { kind: 'fields', name: 'Resources', config: { fields: [{ name: 'Supply', initial: '3' }] } });
    const clock = await makeTool(parts, { kind: 'clock', name: 'Alarm', config: { segments: 4, initial: 1 } });

    const rolled = (await run(parts, dice)).body.record;
    expect(rolled.result.rolls).toHaveLength(2);
    expect(rolled.result.total).toBeGreaterThanOrEqual(3);
    expect((await run(parts, oracle)).body.record.result.roll).toBeGreaterThanOrEqual(1);
    expect(['Rain', 'Fog']).toContain((await run(parts, table)).body.record.result.label);
    const firstCard = (await run(parts, deck)).body.record.result.card;
    const secondCard = (await run(parts, deck)).body.record.result.card;
    expect(new Set([firstCard, secondCard])).toEqual(new Set(['Ash', 'Bell']));
    await request(fixture.app).post(`/api/stories/${parts.story.id}/play-sessions/${parts.session.id}/tool-results`)
      .send({ tool_id: deck.id, input: {} }).expect(409);
    expect((await run(parts, deck, { action: 'reset' })).body.tool.state.remaining).toHaveLength(2);
    expect((await run(parts, fields, { values: { Supply: '2' } })).body.tool.state.values).toEqual({ Supply: '2' });
    expect((await run(parts, clock, { change: 2 })).body.tool.state.current).toBe(3);
    expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM play_ai_requests').get().count).toBe(0);

    const scene = (await request(fixture.app).get(`/api/stories/${parts.story.id}/scenes`).expect(200)).body.scenes[0];
    expect(scene.tool_record_count).toBe(8);
    expect(scene.latest_tool_record.summary).toMatch(/Clock/);
  });

  it('keeps records immutable, snapshots archived tools, and excludes abandoned branch results', async () => {
    const parts = await setup();
    const die = await makeTool(parts, { kind: 'dice', name: 'Fate die', config: { notation: '1d6' } });
    const root = (await request(fixture.app).post(`/api/stories/${parts.story.id}/play-sessions/${parts.session.id}/turns`)
      .send({ kind: 'act', character_id: parts.lead.id, content: 'I reach the arch.' }).expect(201)).body.turn;
    const abandoned = (await run(parts, die)).body.record;
    const forked = (await request(fixture.app).post(`/api/stories/${parts.story.id}/play-sessions/${parts.session.id}/branches`)
      .send({ fork_turn_id: root.id, name: 'Other arch' }).expect(201)).body.session;
    expect((await request(fixture.app).get(`/api/stories/${parts.story.id}/play-sessions/${parts.session.id}/tool-results`).expect(200)).body.records).toEqual([]);
    const selected = (await run(parts, die)).body.record;
    expect(selected.branch_id).toBe(forked.selected_branch_id);
    expect(() => fixture.db.prepare('UPDATE play_tool_records SET summary = ? WHERE id = ?').run('changed', selected.id)).toThrow(/immutable/i);
    await request(fixture.app).delete(`/api/stories/${parts.story.id}/solo-tools/${die.id}`).expect(204);
    const records = (await request(fixture.app).get(`/api/stories/${parts.story.id}/scenes/${parts.scene.id}/tool-results`).expect(200)).body.records;
    expect(records.map((record) => record.id)).toEqual([abandoned.id, selected.id]);
    expect(records.every((record) => record.tool_name === 'Fate die')).toBe(true);
  });

  it('rejects malformed or unsafe tool definitions', async () => {
    const parts = await setup();
    await request(fixture.app).post(`/api/stories/${parts.story.id}/solo-tools`)
      .send({ kind: 'dice', name: 'Too much', config: { notation: '1000d6' } }).expect(400);
    await request(fixture.app).post(`/api/stories/${parts.story.id}/solo-tools`)
      .send({ kind: 'table', name: 'Empty', config: { entries: [] } }).expect(400);
    await request(fixture.app).post(`/api/stories/${parts.story.id}/solo-tools`)
      .send({ kind: 'clock', name: 'Bad clock', config: { segments: 3, initial: 4 } }).expect(400);
  });
});
