'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const { createTestApp, resetDb, createWorld, createCharacter, createStory, addPage } = require('./helpers');
const {
  createContinuityStore,
  validateContinuityDeltaV2,
  ContinuitySchemaError,
} = require('../src/modules/continuity/store');
const { parseJson, verifyEvidenceQuotes } = require('../src/modules/continuity/service');
const { resetModelCache } = require('../src/ai');

let app, db, close;

function reply(content) {
  return { data: { choices: [{ message: { content } }] } };
}

function v2Delta(overrides = {}) {
  return {
    schema_version: 2,
    summary: 'A canonical revision changed the story.',
    events: [],
    character_updates: [],
    goal_updates: [],
    thread_updates: [],
    world_fact_updates: [],
    arc_updates: [],
    ...overrides,
  };
}

function wireDelta(pageContent, value = v2Delta()) {
  const quote = pageContent.slice(0, 500);
  const character_changes = [];
  for (const update of value.character_updates || []) {
    for (const field of ['location', 'condition', 'personality', 'appearance']) {
      if (update[field]) character_changes.push({
        character_id: update.character_id, field, value: update[field],
        related_character_id: null, evidence_quote: quote,
      });
    }
    for (const [source, field] of [
      ['knowledge_gained', 'knowledge_gain'], ['knowledge_lost', 'knowledge_loss'],
      ['possessions_gained', 'possession_gain'], ['possessions_lost', 'possession_loss'],
    ]) {
      for (const item of update[source] || []) character_changes.push({
        character_id: update.character_id, field, value: item,
        related_character_id: null, evidence_quote: quote,
      });
    }
    for (const relationship of update.relationships || []) character_changes.push({
      character_id: update.character_id, field: 'relationship', value: relationship.summary,
      related_character_id: relationship.character_id, evidence_quote: quote,
    });
  }
  const story_changes = [
    ...(value.goal_updates || []).map((item) => ({
      kind: 'goal', id: item.id ?? null, character_id: item.character_id ?? null,
      text: item.text ?? null, state: item.status, evidence_quote: quote,
    })),
    ...(value.thread_updates || []).map((item) => ({
      kind: 'thread', id: item.id ?? null, character_id: null,
      text: item.text ?? null, state: item.status, evidence_quote: quote,
    })),
    ...(value.world_fact_updates || []).map((item) => ({
      kind: 'world_fact', id: item.id ?? null, character_id: null,
      text: item.text ?? null, state: item.status, evidence_quote: quote,
    })),
    ...(value.arc_updates || []).map((item) => ({
      kind: 'arc', id: item.id ?? null, character_id: item.character_id ?? null,
      text: item.text, state: item.movement, evidence_quote: quote,
    })),
  ];
  const events = (value.events || []).map((item) => ({
    text: item.text, character_ids: item.character_ids || [],
    importance: item.importance || 'minor', type: item.type || 'action', evidence_quote: quote,
  }));
  if (!events.length && !character_changes.length && !story_changes.length) {
    events.push({
      text: value.summary, character_ids: [], importance: 'minor',
      type: 'transition', evidence_quote: quote,
    });
  }
  let summary = value.summary;
  const pageWords = new Set(pageContent.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  if (!(summary.toLowerCase().match(/[a-z0-9]{4,}/g) || []).some((word) => pageWords.has(word))) {
    summary = `${summary} ${pageContent}`;
  }
  return JSON.stringify({
    schema_version: 2, summary, summary_evidence: [quote],
    events, character_changes, story_changes,
  });
}

function at(characterId, location, quote) {
  return v2Delta({
    summary: `${location} is now canonical.`,
    events: [{
      id: null,
      text: `${characterId} reaches ${location}.`,
      character_ids: [characterId],
      importance: 'major',
      type: 'transition',
      evidence: [{ quote }],
    }],
    character_updates: [{
      character_id: characterId,
      location,
      condition: null,
      knowledge_gained: [],
      knowledge_lost: [],
      possessions_gained: [],
      possessions_lost: [],
      personality: null,
      appearance: null,
      relationships: [],
      evidence: [{ quote }],
    }],
  });
}

async function sync(storyId, pageId, delta) {
  const pageContent = db.prepare(`
    SELECT revision.content
      FROM pages page
      JOIN page_revisions revision ON revision.id = page.canonical_revision_id
     WHERE page.id = ?
  `).get(pageId).content;
  axios.post.mockResolvedValueOnce(reply(wireDelta(pageContent, delta)));
  return request(app).post(`/api/stories/${storyId}/continuity/pages/${pageId}/sync`).send({}).expect(200);
}

beforeAll(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.AI_RETRY_BASE_DELAY = '1';
  ({ app, db, close } = createTestApp());
});

beforeEach(() => {
  resetDb(db);
  resetModelCache();
  axios.post.mockReset();
  axios.get.mockReset();
});

afterAll(() => {
  close();
  delete process.env.OPENROUTER_API_KEY;
});

describe('continuity ledger v2', () => {
  it('accepts a complete object or one JSON fence, never prose-wrapped or array output', () => {
    expect(parseJson('{"schema_version":2}')).toEqual({ schema_version: 2 });
    expect(parseJson('```json\n{"schema_version":2}\n```')).toEqual({ schema_version: 2 });
    expect(parseJson('Here it is: {"schema_version":2}')).toBeNull();
    expect(parseJson('[{"schema_version":2}]')).toBeNull();
  });

  it('strictly rejects unknown and malformed v2 model fields', () => {
    expect(validateContinuityDeltaV2(v2Delta(), [])).toEqual(v2Delta());
    expect(() => validateContinuityDeltaV2({ ...v2Delta(), surprise: true }, []))
      .toThrow(ContinuitySchemaError);
    expect(() => validateContinuityDeltaV2(v2Delta({
      events: [{ id: null, text: 'A door opens.', character_ids: [], importance: 'major', type: 'action', evidence: [] }],
    }), [])).toThrow(/evidence/);
    const cited = validateContinuityDeltaV2(v2Delta({
      events: [{ id: null, text: 'A door opens.', character_ids: [], importance: 'major', type: 'action', evidence: [{ quote: 'door opens' }] }],
    }), []);
    expect(() => verifyEvidenceQuotes(cited, 'Nothing of the sort occurs.')).toThrow(/quote/i);
    expect(verifyEvidenceQuotes(cited, 'At last, the door opens.')).toBe(cited);
  });

  it('retries a schema-invalid v2 response once instead of silently dropping fields', async () => {
    const story = await createStory(app);
    const pageText = 'The strict ledger begins.';
    const page = await addPage(app, story.id, pageText);
    const invalid = JSON.parse(wireDelta(pageText));
    invalid.unknown = 'unsafe';
    axios.post.mockResolvedValueOnce(reply(JSON.stringify(invalid)))
      .mockResolvedValueOnce(reply(wireDelta(pageText)));

    const result = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);

    expect(result.body.memory).toMatchObject({ status: 'ready', schema_version: 2 });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[1][1].messages.at(-1).content).toMatch(/unknown unknown/i);
  });

  it('rejects a syntactically valid but empty memory and gives the repair its exact defect', async () => {
    const story = await createStory(app);
    const pageText = 'The bronze bell cracks at dawn.';
    const page = await addPage(app, story.id, pageText);
    axios.post.mockResolvedValueOnce(reply(JSON.stringify({
      schema_version: 2,
      summary: 'The bronze bell cracks at dawn.',
      summary_evidence: [pageText],
      events: [],
      character_changes: [],
      story_changes: [],
    }))).mockResolvedValueOnce(reply(wireDelta(pageText)));

    const result = await request(app)
      .post(`/api/stories/${story.id}/continuity/pages/${page.id}/sync`)
      .send({})
      .expect(200);

    expect(result.body.memory.status).toBe('ready');
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[1][1].messages.at(-1).content).toMatch(/no page observation/i);
  });

  it('binds deltas to canonical revisions, preserves copyedits, replaces the tail delta, and truncates suffix effects', async () => {
    const character = await createCharacter(app, null, { name: 'Mara' });
    const story = await createStory(app, null, [{ id: character.id, role: 'mc', relation: null, state: null }]);
    const first = await addPage(app, story.id, 'Mara reaches Harbor One.');
    const second = await addPage(app, story.id, 'Mara reaches Harbor Two.');
    const third = await addPage(app, story.id, 'Mara reaches Harbor Three.');
    await sync(story.id, first.id, at(character.id, 'Harbor One', 'reaches Harbor One'));
    await sync(story.id, second.id, at(character.id, 'Harbor Two', 'reaches Harbor Two'));
    await sync(story.id, third.id, at(character.id, 'Harbor Three', 'reaches Harbor Three'));

    const originalFirstRevision = db.prepare('SELECT canonical_revision_id FROM pages WHERE id = ?').get(first.id).canonical_revision_id;
    await request(app).post(`/api/stories/${story.id}/pages/${first.id}/copyedits`)
      .send({ content: 'Mara REACHES Harbor One.' }).expect(201);
    expect(db.prepare('SELECT canonical_revision_id FROM pages WHERE id = ?').get(first.id).canonical_revision_id)
      .toBe(originalFirstRevision);
    expect(db.prepare('SELECT COUNT(*) AS count FROM continuity_deltas WHERE revision_id = ?').get(originalFirstRevision).count)
      .toBe(1);

    const oldTailRevision = db.prepare('SELECT canonical_revision_id FROM pages WHERE id = ?').get(third.id).canonical_revision_id;
    await request(app).put(`/api/stories/${story.id}/pages/${third.id}/revisions`)
      .send({ content: 'Mara reaches the Winter Inn.' }).expect(200);
    let view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.coverage).toMatchObject({ total: 3, ready: 2 });
    expect(view.body.continuity.characters[0].current.location).toBe('Harbor Two');
    expect(db.prepare('SELECT status FROM continuity_deltas WHERE revision_id = ?').get(oldTailRevision).status).toBe('ready');

    await sync(story.id, third.id, at(character.id, 'Winter Inn', 'reaches the Winter Inn'));
    view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.characters[0].current.location).toBe('Winter Inn');
    expect(view.body.continuity.events.some((event) => event.text.includes('Harbor Three'))).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS count FROM continuity_deltas WHERE story_id = ?').get(story.id).count).toBe(4);

    await request(app).delete(`/api/stories/${story.id}/pages?after=1`).expect(200);
    view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.characters[0].current.location).toBe('Harbor One');
    expect(view.body.continuity.delta_count).toBe(1);
  });

  it('keeps corrections authoritative and discovers later conflicts without inventing edits', async () => {
    const character = await createCharacter(app, null, { name: 'Ilex' });
    const story = await createStory(app, null, [{ id: character.id, role: 'mc', relation: null, state: null }]);
    const first = await addPage(app, story.id, 'Ilex sleeps in the harbor loft.');
    const second = await addPage(app, story.id, 'At dawn, Ilex leaves the harbor loft.');
    await sync(story.id, first.id, at(character.id, 'harbor loft', 'sleeps in the harbor loft'));
    await sync(story.id, second.id, at(character.id, 'harbor road', 'leaves the harbor loft'));
    const revision = db.prepare('SELECT canonical_revision_id FROM pages WHERE id = ?').get(first.id).canonical_revision_id;

    const corrected = await request(app).post(`/api/stories/${story.id}/continuity/corrections`).send({
      scope: 'character',
      subject_id: character.id,
      field: 'location',
      value: 'mountain refuge',
      reason: 'The harbor passage was metaphorical.',
      evidence: [{ page_revision_id: revision, quote: 'sleeps in the harbor loft' }],
    }).expect(201);

    expect(corrected.body.continuity.characters[0].current.location).toBe('mountain refuge');
    expect(corrected.body.continuity.characters[0].evidence.location.correction.correction_id)
      .toBe(corrected.body.correction.id);
    expect(corrected.body.issues).toHaveLength(1);
    expect(corrected.body.issues[0].detail).toMatchObject({ page_id: second.id, suggested_edit: null });
    const issue = await request(app)
      .patch(`/api/stories/${story.id}/continuity/issues/${corrected.body.issues[0].id}`)
      .send({ status: 'acknowledged' }).expect(200);
    expect(issue.body.issue.status).toBe('acknowledged');

    axios.post.mockResolvedValueOnce(reply('The later harbor mention may conflict with the author correction; no prose was changed.'));
    const summary = await request(app)
      .post(`/api/stories/${story.id}/continuity/issues/summary`)
      .send({ issue_ids: [corrected.body.issues[0].id] })
      .expect(200);
    expect(summary.body.summary).toContain('no prose was changed');
    const prompt = axios.post.mock.calls.at(-1)[1].messages;
    expect(prompt[0].content).toContain('Do not propose or apply prose changes');
    expect(prompt[1].content).not.toContain('At dawn, Ilex leaves');
    await request(app).post(`/api/stories/${story.id}/continuity/issues/summary`)
      .send({ issue_ids: ['not-this-story'] }).expect(400);
  });

  it('imports only explicitly reviewed Library template fields', async () => {
    const world = await createWorld(app, { name: 'Old World', description: 'Old world description' });
    const character = await createCharacter(app, world.id, { name: 'Old Name', description: 'Old description', personality: 'Steady' });
    const story = await createStory(app, world.id, [{ id: character.id, role: 'mc', relation: null, state: null }]);
    await request(app).put(`/api/worlds/${world.id}`).send({
      name: 'New World', description: 'New world description', genre: world.genre, setting: world.setting,
    }).expect(200);
    await request(app).put(`/api/characters/${character.id}`).send({
      name: 'New Name', description: 'New description', personality: 'Changed',
      appearance: character.appearance, background: character.background, world_id: world.id,
    }).expect(200);

    const review = await request(app).get(`/api/stories/${story.id}/continuity/templates`).expect(200);
    const characterReview = review.body.templates.find((item) => item.template_kind === 'character');
    expect(characterReview.changes.map((change) => change.field)).toEqual(expect.arrayContaining(['name', 'description', 'personality']));

    await request(app)
      .post(`/api/stories/${story.id}/continuity/templates/character/${character.id}/import`)
      .send({ fields: ['description'] }).expect(201);
    const view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.characters[0]).toMatchObject({ name: 'Old Name', description: 'New description', personality: 'Steady' });
    await request(app)
      .post(`/api/stories/${story.id}/continuity/templates/character/${character.id}/import`)
      .send({ fields: ['secret'] }).expect(400);
  });

  it('keeps editable foundations and versioned author canon separate from extracted evidence', async () => {
    const world = await createWorld(app, { name: 'Ash Coast', description: 'A wind-cut coast.' });
    const character = await createCharacter(app, world.id, { name: 'Mara', personality: 'Guarded' });
    const story = await createStory(app, world.id, [{ id: character.id, role: 'mc', relation: null, state: null }]);

    const edited = await request(app)
      .put(`/api/stories/${story.id}/continuity/templates/world/${world.id}`)
      .send({ values: { description: 'A coast where bells remember storms.' } })
      .expect(200);
    expect(edited.body.continuity.world.description).toBe('A coast where bells remember storms.');
    expect((await request(app).get(`/api/worlds/${world.id}`).expect(200)).body.world.description)
      .toBe('A wind-cut coast.');

    await request(app).put(`/api/worlds/${world.id}`).send({
      name: 'Changed Ash Coast', description: 'The reusable coast changed.',
    }).expect(200);
    const live = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(live.body.continuity.world).toMatchObject({
      name: 'Changed Ash Coast', description: 'A coast where bells remember storms.',
    });
    const templateReview = await request(app).get(`/api/stories/${story.id}/continuity/templates`).expect(200);
    const worldReview = templateReview.body.templates.find((item) => item.template_kind === 'world');
    expect(worldReview.changes.map((change) => change.field)).toEqual(['description']);

    const created = await request(app)
      .post(`/api/stories/${story.id}/continuity/author-canon`)
      .send({
        kind: 'world_event', title: 'The Red Eclipse',
        value: 'The eclipse happened three winters before page one.', note: 'Fixed chronology.',
      })
      .expect(201);
    expect(created.body.entry).toMatchObject({ kind: 'world_event', revision_number: 1, status: 'active' });
    expect(created.body.continuity.author_canon[0].value).toContain('three winters');

    const revised = await request(app)
      .put(`/api/stories/${story.id}/continuity/author-canon/${created.body.entry.id}`)
      .send({ value: 'The eclipse happened four winters before page one.' })
      .expect(200);
    expect(revised.body.entry).toMatchObject({ revision_number: 2 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM author_canon_revisions WHERE entry_id = ?')
      .get(created.body.entry.id).count).toBe(2);

    const prepared = db.prepare('INSERT INTO story_previews (story_id, expected_page, raw_content) VALUES (?, 1, ?)');
    prepared.run(story.id, 'Prepared prose');
    await request(app)
      .delete(`/api/stories/${story.id}/continuity/author-canon/${created.body.entry.id}`)
      .expect(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM story_previews WHERE story_id = ?').get(story.id).count).toBe(0);
    const view = await request(app).get(`/api/stories/${story.id}/continuity`).expect(200);
    expect(view.body.continuity.author_canon).toEqual([]);
    expect(db.prepare('SELECT status FROM author_canon_entries WHERE id = ?').get(created.body.entry.id).status)
      .toBe('retired');
  });

  it('rebuilds a 3,000-page fixture identically and serves bounded inspection state from sparse checkpoints', async () => {
    const story = await createStory(app);
    const chapter = db.prepare(`SELECT chapter.id FROM chapters chapter JOIN volumes volume ON volume.id = chapter.volume_id WHERE volume.story_id = ? LIMIT 1`).get(story.id);
    const insertPage = db.prepare('INSERT INTO pages (id, chapter_id, ordinal) VALUES (?, ?, ?)');
    const insertRevision = db.prepare(`INSERT INTO page_revisions (id, page_id, kind, content, source, cost_usd) VALUES (?, ?, 'canonical', ?, 'migration', 0)`);
    const pointPage = db.prepare('UPDATE pages SET canonical_revision_id = ?, display_revision_id = ? WHERE id = ?');
    const insertDelta = db.prepare(`
      INSERT INTO continuity_deltas (revision_id, story_id, status, schema_version, delta_json, content_hash, summary)
      VALUES (?, ?, 'ready', 2, ?, ?, ?)
    `);
    db.exec('BEGIN');
    try {
      for (let number = 1; number <= 3000; number += 1) {
        const pageId = randomUUID();
        const revisionId = randomUUID();
        const content = `Neutral fixture page ${number}.`;
        const delta = v2Delta({ summary: `Fixture summary ${number}.` });
        insertPage.run(pageId, chapter.id, number);
        insertRevision.run(revisionId, pageId, content);
        pointPage.run(revisionId, revisionId, pageId);
        insertDelta.run(revisionId, story.id, JSON.stringify(delta), '0'.repeat(64), delta.summary);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    const store = createContinuityStore(db);
    const first = store.rebuild(story.id);
    const firstProjection = store.project(db.prepare('SELECT * FROM stories WHERE id = ?').get(story.id));
    const second = store.rebuild(story.id);
    const secondProjection = store.project(db.prepare('SELECT * FROM stories WHERE id = ?').get(story.id));
    expect(first.projection_hash).toBe(second.projection_hash);
    expect(firstProjection.projection_hash).toBe(secondProjection.projection_hash);
    expect(secondProjection.delta_count).toBe(3000);
    expect(secondProjection.history_counts.summaries).toBe(3000);
    expect(secondProjection.summaries).toHaveLength(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM continuity_projection_checkpoints WHERE story_id = ?').get(story.id).count)
      .toBeLessThanOrEqual(61);
  });
});
