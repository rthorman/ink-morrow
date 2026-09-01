import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

// Assemble retired identifiers so the guard does not contain what it bans.
const productNeedles = [
  ['scr', 'ibetr', 'ibe'].join(''),
  ['scr', 'ibe-tr', 'ibe'].join(''),
  ['scr', 'ibe_tr', 'ibe'].join(''),
  ['scr', 'ibe tr', 'ibe'].join(''),
];
const shortPrefix = ['s', 't-'].join('');
const cookieName = ['s', 't_session'].join('');
const retiredInternals = [
  ['__s', 'tEl'].join(''),
  ['__s', 'tRequestClose'].join(''),
  ['__s', 'tWired'].join(''),
  ['__s', 'tLiveBoot'].join(''),
  ['__s', 'tTestAuthAdapter'].join(''),
  ['__s', 'tcribedMedia'].join(''),
  ['__s', 'tcribedPaused'].join(''),
];
const shortPattern = new RegExp(`(^|[^a-z0-9_])${shortPrefix.replace('-', '\\-')}`, 'i');
const decoder = new TextDecoder('utf-8', { fatal: true });
const failures = [];

function inspect(label, value, { text = true } = {}) {
  const lower = value.toLowerCase();
  for (const needle of productNeedles) {
    if (lower.includes(needle)) failures.push(`${label}: retired product identifier`);
  }
  if (!text) return;
  if (shortPattern.test(value)) failures.push(`${label}: retired short namespace`);
  if (lower.includes(cookieName)) failures.push(`${label}: retired cookie identifier`);
  for (const needle of retiredInternals) {
    if (value.includes(needle)) failures.push(`${label}: retired internal namespace`);
  }
}

for (const path of tracked) {
  inspect(path, path);
  const bytes = readFileSync(path);
  const binaryView = bytes.toString('latin1').replaceAll('\0', '');
  inspect(path, binaryView, { text: false });
  try {
    inspect(path, decoder.decode(bytes));
  } catch {
    // Binary files receive the ASCII/UTF-16-NUL product-name scan above.
  }
}

if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  process.exit(1);
}

console.log(`Brand residue check passed across ${tracked.length} tracked files.`);
