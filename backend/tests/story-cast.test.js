'use strict';

const request = require('supertest');
const { createTestApp, resetDb, createWorld, createCharacter, createStory } = require('./helpers');

let app, db, close;

beforeAll(() => {
  ({ app, db, close } = createTestApp());
});

beforeEach(async () => {
  resetDb(db);
});

afterAll(() => close());

async function castStory() {
  const world = await createWorld(app, { name: 'Cast Realm' });
  const mc = await createCharacter(app, world.id, { name: 'The Lead', personality: 'Steadfast' });
  const ally = await createCharacter(app, world.id, { name: 'The Ally', personality: 'Chatty' });
  const late = await createCharacter(app, world.id, { name: 'The Latecomer', personality: 'Quiet' });
  const story = await createStory(app, world.id, [
    { id: mc.id, role: 'mc', relation: null, state: { personality: 'Colder now' } },
    { id: ally.id, role: 'supporting', relation: 'owes a life-debt', state: { appearance: 'Scarred' } },
  ]);
  return { world, mc, ally, late, story };
}

describe('Editing a running story\u2019s cast (PUT /api/stories/:id)', () => {
  it('adds a member, removes a member, and preserves untouched in-story state exactly', async () => {
    const { mc, ally, late, story } = await castStory();

    const res = await request(app)
      .put(`/api/stories/${story.id}`)
      .send({
        characters: [
          { id: mc.id, role: 'mc', relation: null, state: { personality: 'Colder now, and quieter' } },
          { id: late.id, role: 'background', relation: 'a shadow at the edge', state: null },
        ],
      })
      .expect(200);

    const cast = res.body.story.characters;
    expect(cast).toHaveLength(2);
    // The ally is gone; the MC's edited state landed; the latecomer joined
    expect(cast.find((c) => c.id === ally.id)).toBeUndefined();
    expect(cast.find((c) => c.id === mc.id).state).toEqual({ personality: 'Colder now, and quieter' });
    expect(cast.find((c) => c.id === late.id)).toMatchObject({ role: 'background', relation: 'a shadow at the edge' });
  });

  it('edits an in-story sheet in place without losing its siblings', async () => {
    const { mc, story } = await castStory();

    const res = await request(app)
      .put(`/api/stories/${story.id}`)
      .send({
        characters: [
          { id: mc.id, role: 'mc', relation: null, state: { personality: 'Colder now', appearance: 'Cloak burned to rags', relationship_to_mc: 'haunted by her own reflection' } },
        ],
      })
      .expect(200);

    expect(res.body.story.characters[0].state).toEqual({
      personality: 'Colder now',
      appearance: 'Cloak burned to rags',
      relationship_to_mc: 'haunted by her own reflection',
    });
  });

  it('allows a story with no Main Character (the tale becomes an ensemble)', async () => {
    const { ally, story } = await castStory();
    const res = await request(app)
      .put(`/api/stories/${story.id}`)
      .send({ characters: [{ id: ally.id, role: 'supporting', relation: null, state: null }] })
      .expect(200);
    expect(res.body.story.characters.filter((c) => c.role === 'mc')).toHaveLength(0);
  });

  it('still refuses two Main Characters and unknown ids', async () => {
    const { mc, ally, story } = await castStory();
    const two = await request(app)
      .put(`/api/stories/${story.id}`)
      .send({ characters: [
        { id: mc.id, role: 'mc', relation: null, state: null },
        { id: ally.id, role: 'mc', relation: null, state: null },
      ] })
      .expect(400);
    expect(two.body.error).toContain('one main character');

    const ghost = await request(app)
      .put(`/api/stories/${story.id}`)
      .send({ characters: [{ id: 'no-such-character', role: 'supporting', relation: null, state: null }] })
      .expect(400);
    expect(ghost.body.error).toContain('unknown id');
  });

  it('the fresh cast (with state) is what generation sees next', async () => {
    const { mc, late, story } = await castStory();
    await request(app)
      .put(`/api/stories/${story.id}`)
      .send({
        characters: [
          { id: mc.id, role: 'mc', relation: null, state: { personality: 'Colder now' } },
          { id: late.id, role: 'supporting', relation: 'arrived in the night', state: null },
        ],
      })
      .expect(200);

    const res = await request(app).get(`/api/stories/${story.id}`).expect(200);
    expect(res.body.story.characters.find((c) => c.id === late.id).relation).toBe('arrived in the night');
    expect(res.body.story.characters.find((c) => c.id === mc.id).state.personality).toBe('Colder now');
  });
});
