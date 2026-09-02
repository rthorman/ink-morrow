import fs from 'node:fs';

const files = ['package.json', 'backend/package.json', 'frontend/package.json', 'e2e/package.json'];
const versions = files.map((file) => ({ file, version: JSON.parse(fs.readFileSync(file, 'utf8')).version }));
const canonical = versions[0].version;
const mismatches = versions.filter((entry) => entry.version !== canonical);

if (mismatches.length) {
  console.error(`Release version mismatch; package.json declares ${canonical}.`);
  for (const entry of mismatches) console.error(`- ${entry.file}: ${entry.version}`);
  process.exitCode = 1;
} else {
  console.log(`Release identities agree on ${canonical}.`);
}
