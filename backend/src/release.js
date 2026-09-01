'use strict';

// One place for the durable identities introduced by the 4.0 release train.
// Database and archive readers must compare these values before attempting a
// migration or import; feature consumers use the same contract through the
// authenticated /api/capabilities endpoint.

const DATABASE_FAMILY = 'scribetribe-4';
const DATABASE_SCHEMA_VERSION = 9;
const SQLITE_APPLICATION_ID = 0x53543430; // ASCII "ST40"

const ARCHIVE_FORMAT = 'scribetribe-project-archive';
const ARCHIVE_VERSION = 2;
const ARCHIVE_MANIFEST_SCHEMA_VERSION = 1;
const ARCHIVE_EXTENSION = '.scribetribe';

const RELEASE_TRAIN = '4.0.0-beta.1';

const FEATURES = Object.freeze([
  Object.freeze({ id: 'v4-kernel', status: 'available' }),
  Object.freeze({ id: 'manuscript-hierarchy', status: 'available' }),
  Object.freeze({ id: 'revisions-recovery', status: 'available' }),
  Object.freeze({ id: 'providers-vault', status: 'available' }),
  Object.freeze({ id: 'continuity-v2', status: 'available' }),
  Object.freeze({ id: 'writing-transactions', status: 'available' }),
  Object.freeze({ id: 'art-upload', status: 'available' }),
  Object.freeze({ id: 'grok-sanitization', status: 'available' }),
  Object.freeze({ id: 'adaptive-shell', status: 'available' }),
  Object.freeze({ id: 'library-start', status: 'available' }),
  Object.freeze({ id: 'desk', status: 'available' }),
  Object.freeze({ id: 'chronicle', status: 'available' }),
  Object.freeze({ id: 'codex', status: 'available' }),
  Object.freeze({ id: 'gallery', status: 'available' }),
  Object.freeze({ id: 'publication-core', status: 'available' }),
  Object.freeze({ id: 'publication', status: 'available' }),
  Object.freeze({ id: 'snapshot-sharing', status: 'available' }),
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
      status: 'available',
    },
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
