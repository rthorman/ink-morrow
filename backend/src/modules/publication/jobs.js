'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { renderPublication } = require('./adapters');
const { filenameFor } = require('./routes');

function jobError(message, statusCode = 400, code = 'PUBLICATION_JOB_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function createPublicationJobs({
  publications,
  rootDir,
  renderer = renderPublication,
  clock = () => new Date(),
  terminalTtlMs = 60 * 60 * 1000,
  activeTtlMs = 24 * 60 * 60 * 1000,
  sweepIntervalMs = 5 * 60 * 1000,
}) {
  fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    try { fs.rmSync(path.join(rootDir, entry.name), { recursive: true, force: true }); } catch { /* inaccessible stale staging fails later writes honestly */ }
  }
  const jobs = new Map();

  function nowMs() {
    return clock().getTime();
  }

  function terminal(job, status, error = null) {
    job.status = status;
    job.error = error;
    job.updatedAt = clock().toISOString();
    job.terminalAt = nowMs();
  }

  function expired(job) {
    if (job.terminalAt !== null) return nowMs() - job.terminalAt >= terminalTtlMs;
    return nowMs() - job.createdAtMs >= activeTtlMs;
  }

  function expire(job) {
    job.cancelRequested = true;
    jobs.delete(job.id);
    fs.promises.rm(job.stageDir, { recursive: true, force: true }).catch(() => {});
  }

  function sweepExpired() {
    for (const job of jobs.values()) if (expired(job)) expire(job);
  }

  const sweepTimer = setInterval(sweepExpired, Math.max(1000, sweepIntervalMs));
  sweepTimer.unref?.();

  function publicJob(job) {
    return {
      id: job.id,
      snapshot_id: job.snapshotId,
      snapshot_sha256: job.snapshotSha256,
      formats: [...job.formats],
      status: job.status,
      completed_formats: job.outputs.length,
      total_formats: job.formats.length,
      outputs: job.outputs.map((output) => ({
        format: output.format,
        filename: output.filename,
        size_bytes: output.sizeBytes,
        download_url: `/api/publication-jobs/${job.id}/files/${encodeURIComponent(output.filename)}`,
      })),
      error: job.error,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    };
  }

  function validateFormats(formats) {
    if (!Array.isArray(formats) || formats.length < 1 || formats.length > publications.formats.length) {
      throw jobError(`formats must select between 1 and ${publications.formats.length} publication formats.`);
    }
    const unique = [...new Set(formats)];
    if (unique.length !== formats.length || unique.some((format) => !publications.formats.includes(format))) {
      throw jobError(`formats may contain each supported format once: ${publications.formats.join(', ')}.`);
    }
    return unique;
  }

  async function removeStage(job) {
    try { await fs.promises.rm(job.stageDir, { recursive: true, force: true }); } catch { /* cleanup retries on disposal */ }
    job.outputs = [];
  }

  async function run(job) {
    job.status = 'running';
    job.updatedAt = clock().toISOString();
    try {
      await fs.promises.mkdir(job.stageDir, { recursive: true, mode: 0o700 });
      const snapshot = publications.get(job.snapshotId);
      if (!snapshot || snapshot.sha256 !== job.snapshotSha256) throw jobError('Publication snapshot is unavailable.', 409, 'PUBLICATION_SNAPSHOT_UNAVAILABLE');
      for (const format of job.formats) {
        if (job.cancelRequested) break;
        const rendered = await renderer(snapshot.document, format);
        if (job.cancelRequested) break;
        const filename = filenameFor(snapshot.document.metadata.title, rendered.extension);
        const finalPath = path.join(job.stageDir, filename);
        const temporary = `${finalPath}.${randomUUID()}.partial`;
        await fs.promises.writeFile(temporary, rendered.buffer, { flag: 'wx', mode: 0o600 });
        if (job.cancelRequested) {
          await fs.promises.rm(temporary, { force: true });
          break;
        }
        await fs.promises.rename(temporary, finalPath);
        job.outputs.push({ format, filename, path: finalPath, sizeBytes: rendered.buffer.length });
        job.updatedAt = clock().toISOString();
      }
      if (job.cancelRequested) {
        await removeStage(job);
        terminal(job, 'cancelled');
      } else terminal(job, 'ready');
    } catch (error) {
      await removeStage(job);
      terminal(job, 'failed', error.message || 'Publication export failed.');
    }
  }

  function create(snapshotId, formats) {
    const snapshot = publications.get(snapshotId);
    if (!snapshot) throw jobError('Publication snapshot not found.', 404, 'PUBLICATION_SNAPSHOT_NOT_FOUND');
    const id = randomUUID();
    const now = clock().toISOString();
    const job = {
      id,
      snapshotId,
      snapshotSha256: snapshot.sha256,
      formats: validateFormats(formats),
      status: 'queued',
      outputs: [],
      error: null,
      cancelRequested: false,
      stageDir: path.join(rootDir, id),
      createdAt: now,
      createdAtMs: nowMs(),
      updatedAt: now,
      terminalAt: null,
    };
    jobs.set(id, job);
    setImmediate(() => run(job));
    return publicJob(job);
  }

  function get(id) {
    const job = jobs.get(id);
    if (job && expired(job)) {
      expire(job);
      return null;
    }
    return job ? publicJob(job) : null;
  }

  async function cancel(id) {
    const job = jobs.get(id);
    if (!job) return null;
    job.cancelRequested = true;
    if (job.status === 'queued' || job.status === 'ready' || job.status === 'failed') {
      await removeStage(job);
      terminal(job, 'cancelled');
    }
    return publicJob(job);
  }

  function retry(id) {
    const job = jobs.get(id);
    if (!job) throw jobError('Publication job not found.', 404, 'PUBLICATION_JOB_NOT_FOUND');
    if (!['failed', 'cancelled'].includes(job.status)) throw jobError('Only failed or cancelled publication jobs can be retried.', 409, 'PUBLICATION_JOB_NOT_RETRYABLE');
    return create(job.snapshotId, job.formats);
  }

  function file(id, filename) {
    const job = jobs.get(id);
    if (!job) throw jobError('Publication job not found.', 404, 'PUBLICATION_JOB_NOT_FOUND');
    if (job.status !== 'ready') throw jobError('Publication files are not ready.', 409, 'PUBLICATION_JOB_NOT_READY');
    const output = job.outputs.find((entry) => entry.filename === filename);
    if (!output) throw jobError('Publication file not found.', 404, 'PUBLICATION_FILE_NOT_FOUND');
    return output;
  }

  async function remove(id) {
    const job = jobs.get(id);
    if (!job) return false;
    job.cancelRequested = true;
    await removeStage(job);
    jobs.delete(id);
    return true;
  }

  function dispose() {
    clearInterval(sweepTimer);
    for (const job of jobs.values()) job.cancelRequested = true;
    for (const job of jobs.values()) fs.promises.rm(job.stageDir, { recursive: true, force: true }).catch(() => {});
    jobs.clear();
  }

  return { create, get, cancel, retry, file, remove, dispose, rootDir };
}

module.exports = { createPublicationJobs, jobError };
