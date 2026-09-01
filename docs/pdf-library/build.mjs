/* global process */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
for (const [script, args = []] of [['docs/user-guide/render.mjs'],['docs/pdf-library/render.mjs'],['docs/pdf-library/freshness.mjs',['--write']]]) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
