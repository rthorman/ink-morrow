/* global process, console */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const manifestPath = path.join(here, 'generated.json');
const write = process.argv.includes('--write');
const sourceRoots = ['docs/pdf-library/books.mjs','docs/pdf-library/markdown.mjs','docs/pdf-library/render.mjs','docs/pdf-library/theme.css','docs/pdf-library/sources','docs/user-guide/index.html','docs/user-guide/render.mjs','docs/screenshots','frontend/brand','frontend/fonts'];
const outputs = ['docs/user-guide/Ink-Morrow-4.0-User-Guide.pdf','docs/pdf/Ink-Morrow-4.0-Operations-and-Recovery-Handbook.pdf','docs/pdf/Ink-Morrow-4.0-System-Architecture.pdf','docs/pdf/Ink-Morrow-4.0-State-Machine-Atlas.pdf','docs/pdf/Ink-Morrow-4.0-Security-Privacy-and-AI-Boundary.pdf','docs/pdf/Ink-Morrow-4.0-Maintainer-Testing-and-Release-Handbook.pdf'];

async function filesUnder(relative) {
  const absolute = path.join(root, relative);
  const stat = await fs.stat(absolute);
  if (stat.isFile()) return [relative.replaceAll('\\', '/')];
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => filesUnder(path.join(relative, entry.name))))).flat().sort();
}

async function digest(relative) {
  const bytes = await fs.readFile(path.join(root, relative));
  return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

const sources = (await Promise.all(sourceRoots.map(filesUnder))).flat().sort();
const sourceHash = crypto.createHash('sha256');
for (const relative of sources) sourceHash.update(relative).update('\0').update(await fs.readFile(path.join(root, relative))).update('\0');
const current = { schema: 1, source_sha256: sourceHash.digest('hex'), source_count: sources.length, outputs: Object.fromEntries(await Promise.all(outputs.map(async (relative) => [relative, await digest(relative)]))) };

if (write) {
  await fs.writeFile(manifestPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(root, manifestPath)}`);
} else {
  const expected = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(current)) throw new Error('Committed PDFs are stale. Run npm run docs:pdf and commit the PDFs plus docs/pdf-library/generated.json.');
  console.log(`PDF freshness OK (${current.source_count} source/assets, ${outputs.length} PDFs)`);
}
