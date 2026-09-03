'use strict';

const request = require('supertest');
const { createTestApp, createCharacter, createStory } = require('./helpers');

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');

describe('optional scene play sessions', () => {
  let fixture;

  beforeEach(() => {
    fixture = createTestApp();
    axios.post.mockReset();
    axios.get.mockReset();
    process.env.AI_RETRY_BASE_DELAY = '1';
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => fixture.close());

  async function setupScene() {
    const lead = await createCharacter(fixture.app, null, { name: 'Mara Vale' });
    const guide = await createCharacter(fixture.app, null, { name: 'Bell Warden' });
    const story = await createStory(fixture.app, null, [
      { id: lead.id, role: 'mc', relation: 'self', state: null },
      { id: guide.id, role: 'supporting', relation: 'guide', state: null },
    ], { title: 'The Bell Below' });
    const chapter = story.hierarchy.volumes[0].chapters[0];
    const scene = (await request(fixture.app)
      .post(`/api/stories/${story.id}/chapters/${chapter.id}/scenes`)
      .send({
        title: 'At the sealed stair', mode: 'play', viewpoint_character_id: lead.id,
        location: 'Under the bell tower', stakes: 'The sleepers may wake.',
      }).expect(201)).body.scene;
    return { story, scene, lead, guide };
  }

  async function startSession(parts, overrides = {}) {
    return (await request(fixture.app)
      .post(`/api/stories/${parts.story.id}/scenes/${parts.scene.id}/play-sessions`)
      .send({
        participants: [
          { character_id: parts.lead.id, controller: 'owner' },
          { character_id: parts.guide.id, controller: 'scribe' },
        ],
        scribe_initiative: 'high', challenge: 'harsh', pacing: 'brisk',
        consequences: 'meaningful', allow_character_death: false,
        suggestions: 'off', player_interiority: 'owner_only',
        notes: 'Keep the bell physically plausible.',
        ...overrides,
      }).expect(201)).body.session;
  }

  it('keeps play absent until Session Zero and records free owner turns outside manuscript prose', async () => {
    const parts = await setupScene();
    const empty = await request(fixture.app)
      .get(`/api/stories/${parts.story.id}/scenes/${parts.scene.id}/play-sessions`)
      .expect(200);
    expect(empty.body).toMatchObject({ sessions: [], active: null });

    await request(fixture.app)
      .post(`/api/stories/${parts.story.id}/scenes/${parts.scene.id}/play-sessions`)
      .send({ participants: [{ character_id: parts.lead.id, controller: 'owner' }] })
      .expect(400);

    const session = await startSession(parts);
    expect(session).toMatchObject({
      status: 'active', scene_id: parts.scene.id, turn_count: 0,
      challenge: 'harsh', pacing: 'brisk', suggestions: 'off',
      allow_character_death: false,
    });
    expect(session.participants).toEqual([
      expect.objectContaining({ character_id: parts.lead.id, name: 'Mara Vale', controller: 'owner' }),
      expect.objectContaining({ character_id: parts.guide.id, name: 'Bell Warden', controller: 'scribe' }),
    ]);

    const first = await request(fixture.app)
      .post(`/api/stories/${parts.story.id}/play-sessions/${session.id}/turns`)
      .set('Idempotency-Key', 'manual-1')
      .send({ kind: 'act', character_id: parts.lead.id, content: 'I test the lowest stair with my heel.' })
      .expect(201);
    expect(first.body).toMatchObject({ reused: false, turn: { speaker: 'owner', ordinal: 1, input_kind: 'act' } });
    const replay = await request(fixture.app)
      .post(`/api/stories/${parts.story.id}/play-sessions/${session.id}/turns`)
      .set('Idempotency-Key', 'manual-1')
      .send({ kind: 'act', character_id: parts.lead.id, content: 'I test the lowest stair with my heel.' })
      .expect(200);
    expect(replay.body.reused).toBe(true);
    await request(fixture.app)
      .post(`/api/stories/${parts.story.id}/play-sessions/${session.id}/turns`)
      .send({ kind: 'say', character_id: parts.guide.id, content: 'I speak for the Scribe character.' })
      .expect(400);
    expect(fixture.db.prepare('SELECT COUNT(*) AS c FROM manuscript_pages WHERE story_id = ?').get(parts.story.id).c)
      .toBe(0);
    expect(axios.post).not.toHaveBeenCalled();

    await request(fixture.app)
      .delete(`/api/stories/${parts.story.id}/scenes/${parts.scene.id}`)
      .expect(409)
      .expect(({ body }) => expect(body.error).toMatch(/Play history cannot be removed/i));
    expect(fixture.db.prepare('SELECT COUNT(*) AS c FROM play_turns WHERE session_id = ?').get(session.id).c)
      .toBe(1);
  });

  it('gets one idempotent paid Scribe reply bounded by the control contract', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'Dust whispers from the joint. The Bell Warden raises one gloved hand and waits.' } }],
      },
    });
    const parts = await setupScene();
    const session = await startSession(parts);
    const endpoint = `/api/stories/${parts.story.id}/play-sessions/${session.id}/replies`;
    const payload = { kind: 'act', character_id: parts.lead.id, content: 'I put my weight on the stair.' };
    const response = await request(fixture.app).post(endpoint)
      .set('Idempotency-Key', 'reply-1').send(payload).expect(201);
    expect(response.body).toMatchObject({
      reused: false,
      owner_turn: { ordinal: 1, speaker: 'owner' },
      response_turn: { ordinal: 2, speaker: 'scribe', input_kind: 'response' },
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const sent = axios.post.mock.calls[0][1].messages;
    expect(sent[0].content).toMatch(/never decide, speak for, think for/i);
    expect(sent[1].content).toContain('Owner-controlled participants: Mara Vale');
    expect(sent[1].content).toContain('Character death explicitly allowed: NO');
    expect(sent[1].content).toContain('Suggestions: off');
    const contractSnapshot = JSON.parse(fixture.db.prepare(`
      SELECT contract_json FROM play_ai_requests WHERE session_id = ? AND idempotency_key = ?
    `).get(session.id, 'reply-1').contract_json);
    expect(contractSnapshot).toMatchObject({
      challenge: 'harsh', allow_character_death: false,
      participants: [
        expect.objectContaining({ character_id: parts.lead.id, controller: 'owner' }),
        expect.objectContaining({ character_id: parts.guide.id, controller: 'scribe' }),
      ],
    });

    const replay = await request(fixture.app).post(endpoint)
      .set('Idempotency-Key', 'reply-1').send(payload).expect(200);
    expect(replay.body.reused).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(fixture.db.prepare('SELECT COUNT(*) AS c FROM play_turns WHERE session_id = ?').get(session.id).c).toBe(2);

    await request(fixture.app).post(`/api/stories/${parts.story.id}/play-sessions/${session.id}/end`).expect(200);
    await request(fixture.app).post(`/api/stories/${parts.story.id}/play-sessions/${session.id}/turns`)
      .send({ kind: 'ask', content: 'Can this continue?' }).expect(409);
  });

  it('keeps the owner turn and marks the request failed when the provider rejects it', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    axios.post.mockRejectedValue({ response: { status: 401 } });
    const parts = await setupScene();
    const session = await startSession(parts);
    await request(fixture.app)
      .post(`/api/stories/${parts.story.id}/play-sessions/${session.id}/replies`)
      .set('Idempotency-Key', 'failed-reply')
      .send({ kind: 'direct', content: 'Frame the sealed door.' })
      .expect(502);
    expect(fixture.db.prepare('SELECT speaker, content FROM play_turns WHERE session_id = ?').all(session.id))
      .toEqual([{ speaker: 'owner', content: 'Frame the sealed door.' }]);
    expect(fixture.db.prepare('SELECT status, error_code FROM play_ai_requests WHERE session_id = ?').get(session.id))
      .toEqual({ status: 'failed', error_code: 'PLAY_PROVIDER_FAILED' });
  });
});
