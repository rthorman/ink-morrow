# Continuity ledger

ScribeTribe 3.1 treats a committed text page as the transaction boundary of a story. Prose is the source of truth; continuity is a small, derived record linked to that page. This design makes long stories more coherent without requiring a local model, embeddings, a vector service, or repeated whole-manuscript prompts.

## Data layers

| Layer | Purpose | Mutation rule |
|---|---|---|
| Character catalogue | Reusable authoring template and portrait | User edits affect future casting, not existing story identity |
| Cast snapshot | Name and prose sheet frozen when a character first joins a story | Insert once per story/character; never rewritten by catalogue edits |
| Manual cast override | Author-set personality, appearance, or relationship exception | Edited only in the story Cast interface; wins over derived state |
| Page delta | Events and state changes caused by one committed page | Created by the continuity clerk; deleted with its page |
| Continuity correction | Author correction to folded state or status | Explicitly saved in Library; wins over page deltas |

World rows remain live canonical references by design. The ledger records world facts established inside the story, but it does not silently rewrite the reusable world row.

## Commit semantics

- A speculative preview has no page row and therefore no continuity delta.
- Committing a preview inserts the prose page and returns it to the reader before extracting its delta. The server starts extraction in the background; the browser's explicit sync request joins that same per-page job so cost accounting never creates a duplicate provider call.
- A normal write inserts valid prose before extraction. Extraction failure leaves the page valid and marks its memory `failed` for later repair.
- Regeneration writes the replacement against a projection that excludes the old last page. The old prose and delta remain intact during the provider call. Only successful replacement prose updates the row and invalidates the old delta; replacement extraction follows.
- Deleting a page cascades its memory row and search record. Surviving page IDs remain stable while page numbers close the gap. Folding the survivors immediately reverts the deleted facts.
- Truncation applies the same cascade to every removed suffix page.

There is no AI rollback call. Replay is a deterministic local fold ordered by current page number.

## Extracted delta

The clerk receives state through page `N-1`, the direction that led to page `N` as non-authoritative context, and committed prose for page `N`. It emits strict JSON containing:

- a factual summary;
- durable events with involved character IDs, type, and importance;
- character location, condition, knowledge gained/lost, possessions gained/lost, and meaningful appearance/personality/relationship changes;
- goal changes (`pending`, `active`, `fulfilled`, `abandoned`);
- story-thread changes (`open`, `resolved`);
- established or superseded world facts.

The server validates and bounds every field, ignores unknown character IDs, and derives stable IDs for new goals, threads, and facts. JSON Schema is requested when the provider supports it; a provider-level schema rejection falls back to strict plain JSON. Malformed successful output receives one corrective attempt, after which the page stays valid and memory becomes retryable.

The optional `CONTINUITY_MODEL` environment variable selects a dedicated extraction model. Without it, the page's authoring model is reused.

## Author prompt

Page generation receives:

1. tone and explicit reference-sheet handling rules;
2. the live world and frozen cast snapshot;
3. current folded character state;
4. active and resolved goals/threads, established facts, and bounded durable events;
5. up to five recent pages verbatim;
6. up to six older FTS-relevant memory records;
7. the user's current direction.

World, lore, character, and background fields are labelled as data rather than instructions. Plans, desires, vows, and future-tense intentions remain motivations; they are neither proof that an event occurred nor commands to make it recur. Resolved goals are explicitly historical.

## Existing stories and repair

Upgrading creates no paid work. Existing and manually added pages report `pending` coverage until the author chooses **Build missing** in Library → Stories → story assets. Build and rebuild process one page at a time in chronological order, persisting each result before continuing. They are safe to interrupt between pages.

**Rebuild from manuscript** deletes only derived memory/search rows. Pages, cast snapshots, author corrections, and previously spent extraction costs remain. Every new extraction is paid work and passes through the remembered paid-consent review with a numeric estimate and retry ceiling.

## Performance profile

- One compact remote extraction per newly committed text page; none for image pages or previews.
- SQLite rows contain small JSON deltas, not duplicate manuscript text.
- Current state is a local fold over ready deltas; UI history is capped at the latest 200 summaries/events.
- Prompt history is bounded independently of manuscript length.
- FTS5 is used when bundled with SQLite; ordinary indexed storage plus `LIKE` retrieval is the automatic fallback.
- Repair is sequential, avoiding parallel provider load and memory spikes on low-end devices.
- No polling is added for continuity. A prepared commit performs one explicit join to the already-started per-page extraction.

## API

| Method | Route | Result |
|---|---|---|
| `GET` | `/api/stories/:id/continuity` | Coverage, snapshots/current state, goals, threads, facts, recent history, corrections |
| `POST` | `/api/stories/:id/continuity/pages/:pageId/sync` | Extract or repair one committed text page |
| `DELETE` | `/api/stories/:id/continuity` | Clear derived memory and search rows only |
| `PUT` | `/api/stories/:id/continuity/overrides` | Replace sanitized author corrections |

`story_pages.continuity_model`, token counts, and `continuity_cost_usd` preserve extraction accounting. Story totals include authoring and continuity cost.
