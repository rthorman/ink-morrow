import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { books, edition, editionLabel } from '../docs/pdf-library/books.mjs';

const files = ['package.json', 'backend/package.json', 'frontend/package.json', 'e2e/package.json'];
const versions = files.map((file) => ({ file, version: JSON.parse(fs.readFileSync(file, 'utf8')).version }));
const canonical = versions[0].version;
const mismatches = versions.filter((entry) => entry.version !== canonical);

if (mismatches.length) {
  console.error(`Release version mismatch; package.json declares ${canonical}.`);
  for (const entry of mismatches) console.error(`- ${entry.file}: ${entry.version}`);
  process.exitCode = 1;
} else {
  for (const file of files) {
    const lock = JSON.parse(fs.readFileSync(file.replace('package.json', 'package-lock.json'), 'utf8'));
    assert.equal(lock.version, canonical, `${file} lockfile identity`);
    assert.equal(lock.packages[''].version, canonical, `${file} lockfile root identity`);
  }
  const expectedEdition = canonical.split('.').slice(0, 2).join('.');
  assert.equal(edition, expectedEdition, 'PDF edition must match release');
  assert.equal(editionLabel, `${expectedEdition} Edition`, 'Final manuals must not carry transitional labels');
  assert.equal(books.length, 6, 'Ship the complete six-book library');
  for (const book of books) assert.ok(book.output.startsWith(`Ink-Morrow-${expectedEdition}-`), 'PDF filename identity');
  const require = createRequire(import.meta.url);
  const release = require('../backend/src/release');
  assert.equal(release.DATABASE_FAMILY, `ink-morrow-${canonical.split('.')[0]}`, 'New-product database family');
  console.log(`Release identities agree on ${canonical}.`);
}
