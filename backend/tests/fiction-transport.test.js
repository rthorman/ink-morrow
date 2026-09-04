'use strict';

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
const axios = require('axios');
const { createAiClient } = require('../src/ai');
const { createDb } = require('../src/db');
const { createFictionStore } = require('../src/modules/fiction/store');
const { createFictionService } = require('../src/modules/fiction/service');

test('a one-attempt story purchase does not retry an uncertain network failure', async () => {
  axios.post.mockRejectedValue(new Error('Connection lost after dispatch.'));
  const client = createAiClient({ providers: { resolve: () => ({ apiKey: 'dummy', baseUrl: 'https://example.invalid', model: 'test', retryBaseDelay: 1, timeout: 100 }), redact: (value) => value } });
  await expect(client.chatCompletion([{ role: 'user', content: 'A story.' }], { maxAttempts: 1, maxBillableAttempts: 1 })).rejects.toThrow();
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('dispatched work has unknown spend after interruption and cannot commit late', () => {
  const db = createDb(':memory:');
  try {
    const store = createFictionStore(db); const story = store.create({ title: 'A story', premise: 'A reunion.' });
    const started = store.beginRequest(story.id, story.revision, 'dispatch', {});
    store.dispatchRequest(started.request.id, 'test'); store.reconcile();
    expect(store.view(story.id).spend).toEqual({ known_usd: 0, unknown_attempts: 1 });
    expect(() => store.completeRequest(started.request, {})).toThrow('no longer active');
  } finally { db.close(); }
});

test('an uncertain paid failure is visible as unknown rather than free', async () => {
  const db = createDb(':memory:');
  try {
    const store = createFictionStore(db); const story = store.create({ title: 'A story', premise: 'A reunion.' });
    const service = createFictionService({ store, chatCompletion: async () => { throw new Error('Connection lost.'); } });
    await expect(service.reply({ gameId: story.id, expectedRevision: story.revision, idempotencyKey: 'lost', input: { kind: 'follow' } })).rejects.toMatchObject({ billedAttempts: 1, costUsd: null });
    expect(store.view(story.id).spend.unknown_attempts).toBe(1);
  } finally { db.close(); }
});
