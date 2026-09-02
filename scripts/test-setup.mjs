import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const setupSource = new URL('../setup.sh', import.meta.url);

function findBash() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.BASH_PATH,
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'bash',
      ]
    : [process.env.BASH_PATH, 'bash'];
  for (const candidate of candidates.filter(Boolean)) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error('A Bash executable is required to verify setup.sh.');
}

const bash = findBash();
const roots = [];

function fixture({ installed = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ink-morrow-setup-'));
  roots.push(root);
  for (const directory of ['backend', 'frontend', 'e2e', 'test-bin']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(setupSource, join(root, 'setup.sh'));
  writeFileSync(join(root, 'start.sh'), '#!/bin/bash\n');
  writeFileSync(join(root, 'backend', 'package.json'), '{}\n');
  writeFileSync(join(root, 'backend', '.env.example'), 'OPENROUTER_API_KEY=\n');

  const mockNode = `#!/bin/sh
if [ "\${1:-}" = "-e" ]; then
  echo 22
else
  echo v22.5.0
fi
`;
  const mockNpm = `#!/bin/sh
scope=$(basename "$PWD")
case "$scope" in
  backend|frontend|e2e) log=../npm.log ;;
  *) scope=root; log=./npm.log ;;
esac
printf '%s|%s\\n' "$scope" "$*" >> "$log"
`;
  for (const [name, body] of [['node', mockNode], ['npm', mockNpm]]) {
    const path = join(root, 'test-bin', name);
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  }
  for (const directory of installed) {
    const modules = join(root, directory, 'node_modules');
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(modules, 'keep-me'), 'existing dependency tree\n');
  }
  return root;
}

function run(root, args = []) {
  const result = spawnSync(bash, ['./setup.sh', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'test-bin')}${delimiter}${process.env.PATH || ''}`,
    },
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function commands(root) {
  const path = join(root, 'npm.log');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\r?\n/) : [];
}

try {
  const source = readFileSync(setupSource, 'utf8');
  assert.doesNotMatch(source, /(^|[;&|]\s*)rm\s+-[a-zA-Z]*r/m, 'setup.sh must not delete paths itself');

  const existing = fixture({ installed: ['backend'] });
  let result = run(existing);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(commands(existing), ['backend|install --omit=dev']);
  assert.equal(readFileSync(join(existing, 'backend', 'node_modules', 'keep-me'), 'utf8'), 'existing dependency tree\n');
  assert.ok(existsSync(join(existing, 'backend', '.env')));

  const fresh = fixture();
  result = run(fresh);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(commands(fresh), ['backend|ci --omit=dev']);
  assert.doesNotMatch(result.output, /Clean dependency replacement requested/);

  const clean = fixture({ installed: ['backend'] });
  result = run(clean, ['--clean']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(commands(clean), ['backend|ci --omit=dev']);
  assert.match(result.output, /Clean dependency replacement requested/);
  assert.match(result.output.replaceAll('\\', '/'), /\/backend\/node_modules/);

  const dev = fixture({ installed: ['backend', '.', 'frontend', 'e2e'] });
  result = run(dev, ['--dev']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(commands(dev), [
    'backend|install',
    'root|install',
    'frontend|install',
    'e2e|install',
  ]);

  const cleanDev = fixture({ installed: ['backend', '.', 'frontend', 'e2e'] });
  result = run(cleanDev, ['--clean', '--dev']);
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(commands(cleanDev), [
    'backend|ci',
    'root|ci',
    'frontend|ci',
    'e2e|ci',
  ]);
  for (const target of ['node_modules', 'backend/node_modules', 'frontend/node_modules', 'e2e/node_modules']) {
    assert.match(result.output.replaceAll('\\', '/'), new RegExp(target.replace('/', '\\/')));
  }

  const invalid = fixture();
  result = run(invalid, ['--surprise']);
  assert.equal(result.status, 2);
  assert.match(result.output, /Usage: \.\/setup\.sh \[--dev\] \[--clean\]/);
  assert.deepEqual(commands(invalid), []);

  const linked = fixture();
  const linkTarget = join(linked, 'linked-modules');
  mkdirSync(linkTarget);
  try {
    symlinkSync(linkTarget, join(linked, 'backend', 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    result = run(linked, ['--clean']);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Refusing to modify linked dependency directory/);
    assert.deepEqual(commands(linked), []);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
  }

  console.log('setup.sh safety contract passed');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
