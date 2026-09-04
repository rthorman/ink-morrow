'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDb, inspectExistingDatabase, schemaIdentity } = require('../src/db');
const { inspectCopy } = require('../src/core/database-inspection');
const { storagePaths } = require('../src/core/storage');

describe('5.0 fresh data boundary', () => {
  let directory; let handles;
  const snapshot = (file) => ['', '-wal', '-shm', '-journal'].map((suffix) => {
    const target = `${file}${suffix}`; if (!fs.existsSync(target)) return null;
    const stat = fs.statSync(target); return { bytes: fs.readFileSync(target), mode: stat.mode, mtime: stat.mtimeMs };
  });
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'im-five-isolation-')); handles = []; });
  afterEach(() => { for (const db of handles) { try { db.close(); } catch { /* closed */ } } fs.rmSync(directory, { recursive: true, force: true }); jest.restoreAllMocks(); });
  function legacy(file, wal = false) {
    const db = new DatabaseSync(file); handles.push(db);
    if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
    db.exec("CREATE TABLE ink_morrow_schema(singleton INTEGER, family TEXT, version INTEGER); INSERT INTO ink_morrow_schema VALUES(1,'ink-morrow-4',21); CREATE TABLE schema_migrations(version INTEGER); PRAGMA application_id=1229796400; PRAGMA user_version=21;");
    return db;
  }
  test('new stores have the 5.0 family and independent default storage paths', () => {
    const db = createDb(':memory:'); handles.push(db); expect(schemaIdentity(db)).toMatchObject({ family: 'ink-morrow-5', version: 21 }); expect(db.prepare('PRAGMA application_id').get().application_id).toBe(0x494D3530);
    expect(storagePaths({}, '/project/backend')).toEqual({ dbPath: '/project/database-v5/ink-morrow-5.db', storageRoot: '/project/database-v5', ephemeral: false });
    expect(storagePaths({ DATA_DIR: '../private' }, '/project/backend')).toMatchObject({ dbPath: '/project/private/ink-morrow-5.db', storageRoot: '/project/private' });
    expect(storagePaths({ DB_PATH: '../custom/story.db' }, '/project/backend')).toMatchObject({ dbPath: '/project/custom/story.db', storageRoot: '/project/custom' });
    expect(storagePaths({ DATA_DIR: '../images', DB_PATH: '../custom/story.db' }, '/project/backend')).toMatchObject({ dbPath: '/project/custom/story.db', storageRoot: '/project/images' });
    expect(storagePaths({ DB_PATH: ':memory:' }, '/project/backend')).toEqual({ dbPath: ':memory:', storageRoot: null, ephemeral: true });
  });
  test.each([false, true])('refuses an older family without changing database or sidecars (WAL=%s)', (wal) => {
    const file = path.join(directory, 'old.db'); const db = legacy(file, wal); if (!wal) db.close(); fs.chmodSync(file, 0o640);
    const before = snapshot(file); expect(() => createDb(file)).toThrow('not an InkMorrow 5.0'); expect(snapshot(file)).toEqual(before);
    expect(fs.readdirSync(directory).some((name) => name.includes('.bak'))).toBe(false);
  });
  test('a historical WAL without shared memory remains byte-for-byte untouched and gains no SHM', () => {
    const original = path.join(directory, 'source.db'); legacy(original, true);
    const file = path.join(directory, 'old.db'); fs.copyFileSync(original, file); fs.copyFileSync(`${original}-wal`, `${file}-wal`);
    const before = snapshot(file); expect(before[2]).toBeNull(); expect(() => createDb(file)).toThrow('not an InkMorrow 5.0'); expect(snapshot(file)).toEqual(before);
  });
  test('valid 5.0 state committed only in WAL is recognised without touching source and recovers normally', () => {
    const original = path.join(directory, 'source.db'); const db = createDb(original); handles.push(db);
    db.exec('PRAGMA wal_autocheckpoint=0'); db.exec("INSERT INTO fiction_games(id,title,premise,genre,initial_state_json) VALUES('wal-story','Committed in WAL','A quiet room.','drama','{}')");
    const file = path.join(directory, 'recover.db'); fs.copyFileSync(original, file); fs.copyFileSync(`${original}-wal`, `${file}-wal`);
    const before = snapshot(file); expect(inspectExistingDatabase(file)).toMatchObject({ kind: 'recognized', version: 21 }); expect(snapshot(file)).toEqual(before);
    const recovered = createDb(file); handles.push(recovered); expect(recovered.prepare("SELECT title FROM fiction_games WHERE id='wal-story'").get().title).toBe('Committed in WAL');
  });
  test('orphan journals, symlinks and unrecognised SQLite files are not fresh data', () => {
    const missing = path.join(directory, 'missing.db'); fs.writeFileSync(`${missing}-wal`, 'orphan'); expect(() => createDb(missing)).toThrow('missing database'); expect(fs.existsSync(missing)).toBe(false);
    const empty = path.join(directory, 'empty.db'); fs.writeFileSync(empty, ''); fs.writeFileSync(`${empty}-shm`, 'orphan'); expect(() => createDb(empty)).toThrow('empty database');
    const unknown = path.join(directory, 'unknown.db'); const db = new DatabaseSync(unknown); db.exec('CREATE TABLE private_records(value TEXT)'); db.close();
    const link = path.join(directory, 'link.db'); fs.symlinkSync(unknown, link); expect(() => createDb(link)).toThrow('symbolic link'); const before = snapshot(unknown); expect(() => createDb(unknown)).toThrow('could not verify'); expect(snapshot(unknown)).toEqual(before);
  });
  test('temporary copy failure never falls back to connecting to historical files', () => {
    const file = path.join(directory, 'old.db'); legacy(file).close(); const before = snapshot(file);
    jest.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw Object.assign(new Error('No space for preflight.'), { code: 'ENOSPC' }); });
    expect(() => createDb(file)).toThrow('No space for preflight'); expect(snapshot(file)).toEqual(before);
  });
  test('dangling database and journal links cannot be treated as absent fresh storage', () => {
    const target = path.join(directory, 'must-not-create.db');
    const link = path.join(directory, 'dangling.db'); fs.symlinkSync(target, link);
    expect(() => createDb(link)).toThrow('symbolic link'); expect(fs.existsSync(target)).toBe(false);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const file = path.join(directory, `missing${suffix}.db`); fs.symlinkSync(target, `${file}${suffix}`);
      expect(() => createDb(file)).toThrow('missing database'); expect(fs.existsSync(file)).toBe(false); expect(fs.existsSync(target)).toBe(false);
    }
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });
  test('a source changed during inspection is refused rather than trusted as a coherent snapshot', () => {
    const file = path.join(directory, 'changing.db'); fs.writeFileSync(file, 'before');
    expect(() => inspectCopy(file, () => { fs.appendFileSync(file, 'changed by fixture'); return {}; })).toThrow('changed during inspection');
  });
});
