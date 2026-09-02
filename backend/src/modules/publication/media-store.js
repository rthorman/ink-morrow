'use strict';

function mediaError(message, code) {
  const error = new Error(message);
  error.statusCode = 500;
  error.code = code;
  return error;
}

function thinPublicationDocument(document) {
  return {
    ...document,
    assets: document.assets.map(({ content_base64: _content, ...asset }) => ({ ...asset })),
  };
}

function persistPublicationMedia(db, snapshotId, document) {
  const insertBlob = db.prepare(`
    INSERT OR IGNORE INTO publication_blobs
      (sha256, media_type, width, height, size_bytes, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const blob = db.prepare(`
    SELECT media_type, width, height, size_bytes FROM publication_blobs WHERE sha256 = ?
  `);
  const link = db.prepare(`
    INSERT INTO publication_snapshot_assets (snapshot_id, asset_key, sha256) VALUES (?, ?, ?)
  `);
  for (const asset of document.assets) {
    const content = Buffer.from(asset.content_base64, 'base64');
    insertBlob.run(asset.sha256, asset.media_type, asset.width, asset.height, content.length, content);
    const stored = blob.get(asset.sha256);
    if (!stored || stored.media_type !== asset.media_type || Number(stored.width) !== asset.width ||
        Number(stored.height) !== asset.height || Number(stored.size_bytes) !== content.length) {
      throw mediaError('Publication media digest metadata conflicts with stored content.', 'PUBLICATION_MEDIA_CONFLICT');
    }
    link.run(snapshotId, asset.key, asset.sha256);
  }
}

function hydratePublicationDocument(db, snapshotId, storedDocument) {
  if (!storedDocument || !Array.isArray(storedDocument.assets)) {
    throw mediaError('The publication snapshot document is malformed.', 'PUBLICATION_INTEGRITY_FAILED');
  }
  if (storedDocument.assets.every((asset) => typeof asset.content_base64 === 'string')) return storedDocument;
  if (storedDocument.assets.some((asset) => Object.prototype.hasOwnProperty.call(asset, 'content_base64'))) {
    throw mediaError('The publication snapshot has partially detached media.', 'PUBLICATION_INTEGRITY_FAILED');
  }
  const media = new Map(db.prepare(`
    SELECT link.asset_key, link.sha256, blob.media_type, blob.width, blob.height,
           blob.size_bytes, blob.content
      FROM publication_snapshot_assets link
      JOIN publication_blobs blob ON blob.sha256 = link.sha256
     WHERE link.snapshot_id = ?
  `).all(snapshotId).map((row) => [row.asset_key, row]));
  return {
    ...storedDocument,
    assets: storedDocument.assets.map((asset) => {
      const row = media.get(asset.key);
      const content = row ? Buffer.from(row.content) : null;
      if (!row || row.sha256 !== asset.sha256 || row.media_type !== asset.media_type ||
          Number(row.width) !== asset.width || Number(row.height) !== asset.height ||
          Number(row.size_bytes) !== content.length) {
        throw mediaError('Publication media is missing or does not match its snapshot.', 'PUBLICATION_INTEGRITY_FAILED');
      }
      return { ...asset, content_base64: content.toString('base64') };
    }),
  };
}

module.exports = { thinPublicationDocument, persistPublicationMedia, hydratePublicationDocument };
