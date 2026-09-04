'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Even a read-only SQLite connection may create/update WAL shared-memory files.
// Inspect an isolated copy instead. It is a preflight, never a live backup or a
// restore source. Source files are only stat'ed/read; SQLite sees the private copy.
// https://sqlite.org/wal.html#read_only_databases
function inspectCopy(dbPath, inspect) {
  const suffixes = ['', '-wal', '-journal'];
  const stamp = (file) => {
    let stat;
    try { stat = fs.lstatSync(file, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Database and journal paths must be regular files, not symbolic links.');
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String).join(':');
  };
  const before = suffixes.map((suffix) => stamp(`${dbPath}${suffix}`));
  const unchanged = () => {
    if (suffixes.some((suffix, index) => stamp(`${dbPath}${suffix}`) !== before[index])) throw new Error('Database files changed during inspection. Stop other processes using this database and try again.');
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inkmorrow-db-preflight-'));
  const copied = path.join(directory, 'inspection.db');
  try {
    fs.chmodSync(directory, 0o700);
    for (let index = 0; index < suffixes.length; index++) {
      if (!before[index]) continue;
      const target = `${copied}${suffixes[index]}`;
      // COPYFILE_FICLONE is opportunistic: ordinary copy is the documented
      // fallback. Never buffer a whole database or WAL in JavaScript memory.
      fs.copyFileSync(`${dbPath}${suffixes[index]}`, target, fs.constants.COPYFILE_FICLONE);
      fs.chmodSync(target, 0o600);
    }
    unchanged();
    const result = inspect(copied);
    unchanged();
    return result;
  } finally {
    // Only the unique private scratch directory created above, never user data.
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function hasDatabaseSidecars(dbPath) {
  return ['-wal', '-shm', '-journal'].some((suffix) => {
    // lstat also detects dangling links; they must never count as fresh storage.
    try { fs.lstatSync(`${dbPath}${suffix}`); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
}

module.exports = { inspectCopy, hasDatabaseSidecars };
