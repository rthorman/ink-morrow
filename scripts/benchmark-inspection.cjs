'use strict';
const fs = require('node:fs'),
  os = require('node:os'),
  { performance } = require('node:perf_hooks');
const repo = require('node:path').resolve(__dirname, '..');
const { createDb } = require(repo + '/backend/src/db');
const { createFictionStore } = require(repo + '/backend/src/modules/fiction/store');
const { createWorkspaceQueries } = require(repo + '/backend/src/modules/fiction/workspace-queries');
const root = fs.mkdtempSync('/tmp/im-b2-bench-'),
  file = root + '/fixture.db';
const db = createDb(file),
  store = createFictionStore(db),
  queries = createWorkspaceQueries({ db, store });
let story = store.create({ scenario_id: 'drowned-bell' });
const game = store.current(story.id).game;
let state = JSON.parse(game.initial_state_json);
let parent = story.head_beat_id;
const results = [];
const insert = db.prepare(
  'INSERT INTO fiction_beats(id,game_id,branch_id,parent_id,kind,prose,summary,input_json,state_json,changes_json) VALUES(?,?,?,?,?,?,?,?,?,?)'
);
const take = (fn, n = 30) => {
  const values = [];
  let result;
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    result = fn();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return {
    p50_ms: +values[Math.floor(n * 0.5)].toFixed(2),
    p95_ms: +values[Math.floor(n * 0.95)].toFixed(2),
    response_bytes: Buffer.byteLength(JSON.stringify(result))
  };
};
for (let n = 2; n <= 10000; n++) {
  const id = 'moment-' + n;
  const fact = {
    id: 'bench-' + (n % 24),
    kind: 'fact',
    text: 'Harbour record ' + n,
    visibility: n % 7 === 0 ? 'secret' : 'public',
    known_by: [],
    status: 'active',
    actor_id: null,
    value: null,
    evidence_beat_id: id
  };
  state.facts = state.facts.filter((f) => f.id !== fact.id);
  state.facts.push(fact);
  state.scene_count = n;
  insert.run(
    id,
    story.id,
    story.active_branch_id,
    parent,
    'scene',
    'The harbour holds another ordinary day.',
    'Harbour day ' + n,
    JSON.stringify({ kind: 'follow', text: '' }),
    JSON.stringify(state),
    JSON.stringify([{ op: n < 26 ? 'remember' : 'correct', fact }])
  );
  parent = id;
  if ([500, 3000, 10000].includes(n)) {
    db.prepare('UPDATE fiction_branches SET head_beat_id=? WHERE id=?').run(parent, story.active_branch_id);
    db.prepare('UPDATE fiction_games SET revision=? WHERE id=?').run(n, story.id);
    const coldStart = performance.now();
    queries.codex(story.id);
    const cold = performance.now() - coldStart;
    results.push({
      moments: n,
      cold_codex_ms: +cold.toFixed(2),
      timeline: take(() => queries.timeline(story.id)),
      codex: take(() => queries.codex(story.id)),
      passage: take(() => queries.passages(story.id, parent)),
      database_bytes: fs.statSync(file).size,
      rss_bytes: process.memoryUsage().rss
    });
  }
}
const evidence = {
  runtime: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: os.cpus()[0].model,
  hardware_threads: os.cpus().length,
  fixture:
    '10,000 synthetic narrative moments; 24 recurring fact identities with public/private corrections; ordinary original scenario. No providers, images, human prose quality or Android hardware measured. Cross-path boundaries are tested separately; this latency fixture has one long path.',
  samples: 30,
  results,
  query_plan: db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT beat_id FROM fiction_history_index WHERE game_id=? AND narrative_ordinal=? AND is_narrative=1'
    )
    .all(story.id, 9000)
};
db.close();
fs.rmSync(root, { recursive: true, force: true });
fs.writeFileSync(repo + '/docs/recovery/evidence/B2-QUERY-BENCHMARK.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(results));
