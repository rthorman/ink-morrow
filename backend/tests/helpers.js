'use strict';

const request = require('supertest');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

/**
 * Creates a fully isolated test app backed by its own in-memory database.
 * Tests never touch the real database file.
 */
function createTestApp(options = {}) {
  const db = createDb(':memory:');
  // Collect logger output instead of spilling stderr; tests that care about
  // expected provider/quality failures assert against these entries.
  const logEntries = [];
  const logger = {
    log: (msg) => logEntries.push({ level: 'log', msg }),
    error: (msg) => logEntries.push({ level: 'error', msg }),
  };
  const authOptions = options.authRequired
    ? {
        setupCode: 'TEST-SETUP-CODE',
        scryptParams: { N: 1024, r: 8, p: 1, maxmem: 8 * 1024 * 1024 },
        delay: async () => {},
        ...(options.authOptions || {}),
      }
    : options.authOptions;
  const app = createApp(db, { staticDir: null, logger, ...options, authOptions });
  app.locals.logEntries = logEntries;
  return {
    db,
    app,
    logEntries,
    close: () => {
      app.locals.dispose?.();
      db.close();
    },
  };
}

/** Clear all rows between tests within a file (keeps schema + open handle). */
function resetDb(db) {
  db.exec(`
    DELETE FROM operation_journal;
    DELETE FROM shares;
    DELETE FROM publication_snapshots;
    DELETE FROM asset_placements;
    DELETE FROM assets;
    DELETE FROM recovery_suffixes;
    DELETE FROM continuity_issues;
    DELETE FROM continuity_corrections;
    DELETE FROM continuity_deltas;
    DELETE FROM writing_operations;
    DELETE FROM prepared_pages;
    DELETE FROM page_revisions;
    DELETE FROM pages;
    DELETE FROM chapters;
    DELETE FROM volumes;
    DELETE FROM auth_sessions;
    DELETE FROM auth_owner;
    DELETE FROM story_pages;
    DELETE FROM stories;
    DELETE FROM characters;
    DELETE FROM worlds;
  `);
}

async function setupOwner(agent, app, password = 'A long test password phrase') {
  const res = await agent
    .post('/api/auth/setup')
    .send({
      setup_code: app.locals.auth.setupCode,
      password,
      remember: true,
    });
  if (res.status !== 201) throw new Error(`setupOwner failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// Convenience creators used across test files

async function createWorld(app, overrides = {}) {
  const res = await request(app)
    .post('/api/worlds')
    .send({ name: 'Test World', description: 'A realm of testing', genre: 'Fantasy', setting: 'Medieval', ...overrides });
  if (res.status !== 201) throw new Error(`createWorld failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.world;
}

async function createCharacter(app, worldId = null, overrides = {}) {
  const res = await request(app)
    .post('/api/characters')
    .send({
      name: 'Sir Gideon',
      description: 'A brave knight',
      personality: 'Honorable and brave',
      appearance: 'Tall with silver armor',
      background: 'Former royal guard',
      world_id: worldId,
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`createCharacter failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.character;
}

async function createStory(app, worldId = null, cast = [], overrides = {}) {
  // Accept [{id, role, ...}] objects; also accept plain ids for brevity,
  // normalized to supporting cast entries (API requires objects - this helper
  // exists for tests, not as an API contract).
  const characters = cast.map((entry) =>
    typeof entry === 'string' ? { id: entry, role: 'supporting', relation: null, state: null } : entry
  );
  const res = await request(app)
    .post('/api/stories')
    .send({ title: 'The Test Tale', world_id: worldId, characters, ...overrides });
  if (res.status !== 201) throw new Error(`createStory failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.story;
}

async function addPage(app, storyId, content = 'Page content.', userInput = null) {
  const res = await request(app)
    .post(`/api/stories/${storyId}/pages`)
    .send({ content, user_input: userInput });
  if (res.status !== 201) throw new Error(`addPage failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.page;
}

module.exports = {
  createTestApp,
  resetDb,
  createWorld,
  createCharacter,
  createStory,
  addPage,
  setupOwner,
};
