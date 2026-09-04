'use strict';

// Durable identity for the new 5.0 product. Older data is never adopted.
// Database and archive readers must compare these values before attempting a
// migration or import; feature consumers use the same contract through the
// authenticated /api/capabilities endpoint.

const DATABASE_FAMILY = 'ink-morrow-5';
const DATABASE_SCHEMA_VERSION = 22;
const SQLITE_APPLICATION_ID = 0x494D3530; // ASCII "IM50"

const ARCHIVE_FORMAT = 'ink-morrow-project-archive';
const ARCHIVE_VERSION = 2;
const ARCHIVE_MANIFEST_SCHEMA_VERSION = 1;
const ARCHIVE_EXTENSION = '.inkmorrow';

const RELEASE_TRAIN = require('../../package.json').version;

const FEATURES = Object.freeze([
  Object.freeze({ id: 'playable-fiction-state', status: 'available' }),
  Object.freeze({ id: 'reader-director', status: 'available' }),
  Object.freeze({ id: 'living-world-resistance', status: 'available' }),
  Object.freeze({ id: 'durable-fiction-memory', status: 'available' }),
  Object.freeze({ id: 'character-relationships', status: 'available' }),
  Object.freeze({ id: 'episode-framing', status: 'available' }),
  Object.freeze({ id: 'optional-consistency-quality', status: 'available' }),
  Object.freeze({ id: 'fourth-wall-dialogue', status: 'available' }),
  Object.freeze({ id: 'providers-vault', status: 'available' }),
  Object.freeze({ id: 'fiction-illustrations', status: 'available' }),
  Object.freeze({ id: 'visual-catalogues', status: 'available' }),
  Object.freeze({ id: 'story-covers-and-portraits', status: 'available' }),
  Object.freeze({ id: 'fiction-books', status: 'available' }),
  Object.freeze({ id: 'fiction-saves', status: 'available' }),
]);

function releaseCapabilities(applicationVersion) {
  return {
    application_version: applicationVersion,
    release_train: RELEASE_TRAIN,
    database: {
      family: DATABASE_FAMILY,
      schema_version: DATABASE_SCHEMA_VERSION,
    },
    archive: {
      format: ARCHIVE_FORMAT,
      version: ARCHIVE_VERSION,
      manifest_schema_version: ARCHIVE_MANIFEST_SCHEMA_VERSION,
      status: 'retired',
    },
    playable_save: { format: 'ink-morrow-fiction-save', version: 1, extension: '.inkmorrow5', status: 'available', imports_older_series: false },
    features: FEATURES.map((feature) => ({ ...feature })),
  };
}

module.exports = {
  DATABASE_FAMILY,
  DATABASE_SCHEMA_VERSION,
  SQLITE_APPLICATION_ID,
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  ARCHIVE_MANIFEST_SCHEMA_VERSION,
  ARCHIVE_EXTENSION,
  RELEASE_TRAIN,
  FEATURES,
  releaseCapabilities,
};
