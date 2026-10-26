'use strict';
// Synthetic in-memory stress fixture; never reads an owner installation.
const { performance } = require('node:perf_hooks');
const { createDb } = require('../backend/src/db');
const { createFictionStore } = require('../backend/src/modules/fiction/store');
const {
  createWorkspaceQueries,
} = require('../backend/src/modules/fiction/workspace-queries');
const { createEditorial } = require('../backend/src/modules/fiction/editorial');
const results = [];
for (const count of [500, 3000, 10000]) {
  const db = createDb(':memory:');
  try {
    const store = createFictionStore(db),
      story = store.create({
        title: 'Synthetic editorial benchmark',
        premise: 'An empty garden.',
      });
    const state = store.current(story.id).state;
    const insert = db.prepare(
      "INSERT INTO fiction_beats(id,game_id,branch_id,parent_id,kind,prose,summary,input_json,state_json,changes_json) VALUES(?,?,?,?,'scene','A synthetic garden moment.','A synthetic garden moment.','{}',?,'[]')",
    );
    let parent = null;
    db.exec('BEGIN');
    for (let index = 0; index < count; index++) {
      state.episode.number = Math.floor(index / 200) + 1;
      state.episode.title = 'Episode ' + state.episode.number;
      const id = 'synthetic-passage-' + index;
      insert.run(
        id,
        story.id,
        story.active_branch_id,
        parent,
        JSON.stringify(state),
      );
      parent = id;
    }
    db.prepare('UPDATE fiction_branches SET head_beat_id=? WHERE id=?').run(
      parent,
      story.active_branch_id,
    );
    db.prepare('UPDATE fiction_games SET revision=? WHERE id=?').run(
      count,
      story.id,
    );
    db.exec('COMMIT');
    const editorial = createEditorial({
      db,
      store,
      queries: createWorkspaceQueries({ db, store }),
    });
    const measure = (work) => {
      const times = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        const start = performance.now();
        work();
        times.push(performance.now() - start);
      }
      times.shift();
      times.sort((a, b) => a - b);
      return {
        median_ms: +times[2].toFixed(2),
        max_ms: +times.at(-1).toFixed(2),
      };
    };
    results.push({
      narrative_passages: count,
      outline: measure(() => editorial.inspect(story.id, { outline: '1' })),
      boundary_page: measure(() => editorial.passages(story.id)),
    });
  } finally {
    db.close();
  }
}
process.stdout.write(
  JSON.stringify(
    {
      node: process.version,
      fixture:
        'Synthetic in-memory projection stress data; not owner data, portable-story validation or Android acceptance.',
      samples_after_warmup: 5,
      results,
    },
    null,
    2,
  ) + '\n',
);
