'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createTestApp, createStory, addPage } = require('./helpers');
const { createPublicationJobs } = require('../src/modules/publication/jobs');
const { renderPublication, rereadPublication } = require('../src/modules/publication/adapters');

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function waitFor(read, predicate, attempts = 100) {
  for (let count = 0; count < attempts; count += 1) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for publication job.');
}

describe('PR 16 multi-format publication jobs', () => {
  let fixture;

  beforeEach(() => { fixture = createTestApp(); });
  afterEach(() => fixture.close());

  async function snapshot() {
    const story = await createStory(fixture.app, null, [], { title: 'Bound Together' });
    await addPage(fixture.app, story.id, 'First paragraph.\n\n***\n\nSecond paragraph.');
    return fixture.app.locals.publications.snapshot(story.id, { metadata: { author: 'Test Author' } });
  }

  it('builds EPUB, PDF, and text from one immutable snapshot with progress and downloads', async () => {
    const source = await snapshot();
    const created = await request(fixture.app)
      .post(`/api/publications/${source.id}/exports`)
      .send({ formats: ['epub', 'pdf', 'txt'] })
      .expect(202);
    expect(created.body.job).toMatchObject({
      snapshot_id: source.id,
      snapshot_sha256: source.sha256,
      status: 'queued',
      total_formats: 3,
    });

    const ready = await waitFor(
      async () => (await request(fixture.app).get(`/api/publication-jobs/${created.body.job.id}`).expect(200)).body.job,
      (job) => job.status === 'ready',
    );
    expect(ready.completed_formats).toBe(3);
    expect(ready.outputs.map((output) => output.format)).toEqual(['epub', 'pdf', 'txt']);
    const expected = rereadPublication('json', (await renderPublication(source.document, 'json')).buffer);
    for (const output of ready.outputs) {
      const downloaded = await request(fixture.app).get(output.download_url).buffer().parse(binaryParser).expect(200);
      expect(rereadPublication(output.format, downloaded.body)).toEqual(expected);
    }

    const stage = path.join(fixture.app.locals.publicationJobs.rootDir, ready.id);
    expect(fs.readdirSync(stage).sort()).toEqual(ready.outputs.map((output) => output.filename).sort());
    await request(fixture.app).delete(`/api/publication-jobs/${ready.id}`).expect(204);
    expect(fs.existsSync(stage)).toBe(false);
    await request(fixture.app).get(ready.outputs[0].download_url).expect(404);
  });

  it('cancels without a partial download or staging leak', async () => {
    const source = await snapshot();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-publication-cancel-'));
    let release;
    let started;
    const didStart = new Promise((resolve) => { started = resolve; });
    const renderer = async (...args) => {
      started();
      await new Promise((resolve) => { release = resolve; });
      return renderPublication(...args);
    };
    const jobs = createPublicationJobs({ publications: fixture.app.locals.publications, rootDir: root, renderer });
    try {
      const job = jobs.create(source.id, ['pdf']);
      await didStart;
      const cancelling = jobs.cancel(job.id);
      release();
      await cancelling;
      const cancelled = await waitFor(() => jobs.get(job.id), (value) => value.status === 'cancelled');
      expect(cancelled.outputs).toEqual([]);
      expect(fs.existsSync(path.join(root, job.id))).toBe(false);
      expect(() => jobs.file(job.id, 'bound-together.pdf')).toThrow(/not ready/i);
    } finally {
      jobs.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('retries a failed job as a new clean lifecycle', async () => {
    const source = await snapshot();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'im-publication-retry-'));
    let fail = true;
    const jobs = createPublicationJobs({
      publications: fixture.app.locals.publications,
      rootDir: root,
      renderer: async (...args) => {
        if (fail) { fail = false; throw new Error('Deliberate adapter fault'); }
        return renderPublication(...args);
      },
    });
    try {
      const original = jobs.create(source.id, ['txt']);
      const failed = await waitFor(() => jobs.get(original.id), (value) => value.status === 'failed');
      expect(failed.outputs).toEqual([]);
      expect(fs.existsSync(path.join(root, original.id))).toBe(false);
      const retry = jobs.retry(original.id);
      expect(retry.id).not.toBe(original.id);
      const ready = await waitFor(() => jobs.get(retry.id), (value) => value.status === 'ready');
      expect(ready.outputs).toHaveLength(1);
    } finally {
      jobs.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
