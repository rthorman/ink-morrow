'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

function shareError(message, statusCode = 400, code = 'PUBLICATION_SHARE_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function capabilityHash(capability) {
  return createHash('sha256').update(capability, 'utf8').digest('hex');
}

function instant(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Publication share clock returned an invalid instant.');
  return date;
}

function expiryFrom(value, now) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isSafeInteger(value) || value < 300 || value > MAX_EXPIRY_SECONDS) {
    throw shareError('expires_in_seconds must be an integer from 300 seconds through 365 days.');
  }
  return new Date(now.getTime() + value * 1000).toISOString();
}

function createPublicationShares({ db, publications, clock = () => new Date(), tokenBytes = randomBytes }) {
  const insert = db.prepare(`
    INSERT INTO shares
      (id, publication_snapshot_id, capability_hash, status, created_at, expires_at)
    VALUES (?, ?, ?, 'active', ?, ?)
  `);
  const byHash = db.prepare(`
    SELECT id, publication_snapshot_id, status, created_at, expires_at, revoked_at
      FROM shares WHERE capability_hash = ?
  `);
  const byId = db.prepare(`
    SELECT s.id, s.publication_snapshot_id, s.status, s.created_at, s.expires_at, s.revoked_at,
           p.story_id, p.sha256 AS snapshot_sha256
      FROM shares s
      JOIN publication_snapshots p ON p.id = s.publication_snapshot_id
     WHERE s.id = ?
  `);
  const listByStory = db.prepare(`
    SELECT s.id, s.publication_snapshot_id, s.status, s.created_at, s.expires_at, s.revoked_at,
           p.story_id, p.sha256 AS snapshot_sha256
      FROM shares s
      JOIN publication_snapshots p ON p.id = s.publication_snapshot_id
     WHERE p.story_id = ?
     ORDER BY s.created_at DESC, s.id DESC
  `);
  const revokeRow = db.prepare(`
    UPDATE shares SET status = 'revoked', revoked_at = ?
     WHERE id = ? AND status = 'active'
  `);

  function present(row, now = instant(clock)) {
    const expired = row.status === 'active' && row.expires_at !== null && new Date(row.expires_at).getTime() <= now.getTime();
    return Object.freeze({
      id: row.id,
      snapshot_id: row.publication_snapshot_id,
      snapshot_sha256: row.snapshot_sha256,
      story_id: row.story_id,
      status: expired ? 'expired' : row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
    });
  }

  function create(snapshotId, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some((key) => key !== 'expires_in_seconds')) {
      throw shareError('Publication share options contain an unsupported field.');
    }
    const snapshot = publications.get(snapshotId);
    if (!snapshot) throw shareError('Publication snapshot not found.', 404, 'PUBLICATION_SNAPSHOT_NOT_FOUND');
    const now = instant(clock);
    const capability = tokenBytes(32).toString('base64url');
    if (!CAPABILITY_PATTERN.test(capability)) throw new Error('Capability generator did not return 256 bits.');
    const id = randomUUID();
    const createdAt = now.toISOString();
    const expiresAt = expiryFrom(options.expires_in_seconds, now);
    insert.run(id, snapshot.id, capabilityHash(capability), createdAt, expiresAt);
    const row = byId.get(id);
    return Object.freeze({
      ...present(row, now),
      share_url: `/share/#${capability}`,
    });
  }

  function list(storyId) {
    if (!storyId || typeof storyId !== 'string') throw shareError('story_id is required.');
    const now = instant(clock);
    return Object.freeze(listByStory.all(storyId).map((row) => present(row, now)));
  }

  function revoke(id) {
    const row = byId.get(id);
    if (!row) throw shareError('Publication share not found.', 404, 'PUBLICATION_SHARE_NOT_FOUND');
    if (row.status === 'active') revokeRow.run(instant(clock).toISOString(), id);
    return present(byId.get(id));
  }

  function resolve(capability) {
    if (!CAPABILITY_PATTERN.test(String(capability || ''))) return null;
    const row = byHash.get(capabilityHash(capability));
    if (!row || row.status !== 'active') return null;
    const now = instant(clock);
    if (row.expires_at !== null && new Date(row.expires_at).getTime() <= now.getTime()) return null;
    const snapshot = publications.get(row.publication_snapshot_id);
    if (!snapshot) return null;
    return Object.freeze({
      share: Object.freeze({ id: row.id, created_at: row.created_at, expires_at: row.expires_at }),
      snapshot,
    });
  }

  return Object.freeze({ create, list, revoke, resolve });
}

module.exports = {
  CAPABILITY_PATTERN,
  MAX_EXPIRY_SECONDS,
  capabilityHash,
  createPublicationShares,
};
