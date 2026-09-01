'use strict';

// Termux tears down Playwright's webServer child only when a run exits
// normally - an aborted run (Ctrl-C, tool timeout) orphans `node server.js`,
// which then blocks the next invocation's port or, worse, serves it stale
// data. Run this BEFORE `playwright test` (see package.json scripts and
// AGENTS.md). A stray matches ONLY IF BOTH hold:
//   - its argv script is exactly 'server.js' (bare, the e2e cwd form - the
//     dev server runs 'node /abs/path/backend/server.js' and never matches)
//   - its environment carries NODE_ENV=e2e (only e2e servers run with it)
const fs = require('fs');

// The narrow process inspection below is Linux/Termux-specific. On Windows,
// Playwright owns the server process and port checks still fail closed; skip
// the orphan sweep instead of making the entire test command unusable.
if (!fs.existsSync('/proc')) {
  console.log('[e2e sweep] /proc unavailable; skipped orphan scan');
  process.exit(0);
}

let swept = 0;
for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
  const n = Number(pid);
  if (n === process.pid) continue;
  let argv;
  try {
    argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  } catch {
    continue;
  }
  if (argv[1] !== 'server.js') continue;
  let env;
  try {
    env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
  } catch {
    continue;
  }
  if (!env.includes('NODE_ENV=e2e')) continue;
  try {
    process.kill(n, 'SIGKILL');
    swept++;
    console.log(`[e2e sweep] killed orphaned e2e server (pid ${n})`);
  } catch {
    // already gone
  }
}
if (swept === 0) console.log('[e2e sweep] no orphaned e2e servers');

