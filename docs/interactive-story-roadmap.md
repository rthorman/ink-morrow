# Interactive Story roadmap

Status: **approved for implementation on the 4.1 line**  
Scope: single-owner authoring and solo textual roleplay

Ink Morrow will support authoring and roleplay as two optional ways to create
the same Story. Existing manual and AI-assisted manuscript writing remains the
shortest path. No new feature in this programme may turn scene planning,
roleplay, mechanics, or AI review into required setup.

## Product invariants

- The owner remains the dominant author. AI proposes; the owner decides.
- A manuscript may contain no scene records at all.
- Scenes and play records are working structure. Publication contains only
  prose and explicitly selected art.
- The AI never supplies a player character's decisions, speech, thoughts, or
  completed actions unless that character is explicitly assigned shared or
  Scribe control.
- Only one timeline is canonical. Alternate histories are noncanonical until
  the owner explicitly promotes one through a reviewed operation.
- Random results and arithmetic come from deterministic application code,
  never invented or silently changed by a language model.
- Extracted campaign state is inspectable, correctable, and linked to its
  source turn or page.
- Every provider call retains the existing review, idempotency, accounting,
  failure, and stale-response guarantees. Manual equivalents call no provider.
- Portable backups preserve every enabled part of this programme without
  credentials, authentication state, or surprise AI work.

## Delivery order

### 1. Optional Scene and Session foundation

Add chapter-owned Scene records with planning/play mode, status, viewpoint,
location, story time, purpose, stakes, and optional contiguous page grouping.
Chronicle owns scene planning. Deleting a scene ungroups pages and never
deletes prose. Existing manuscripts receive no guessed or automatic scenes.

### 2. Play contracts and session turns

Add an opt-in Play surface for a scene. Session Zero records participant
control (owner, Scribe, or shared), Scribe initiative, challenge, pacing,
consequence/death permissions, suggestion preference, and player-interiority
limits. Inputs distinguish Act, Say, Ask, and Direct. Raw turns remain working
history until explicitly shaped into prose.

### 3. Living campaign state

Extend the continuity model with relationship changes, promises and debts,
knowledge boundaries, secrets and witnesses, NPC goals, factions, quests,
conditions, inventory, resources, world time, deadlines, and progress clocks.
Retrieval remains bounded and uses Main, Supporting, and Background priority.
Opening a scene offers a source-linked recap rather than replaying the full
history.

### 4. Alternate histories and Play into Prose

Allow a session to fork from an immutable turn while keeping every fork
noncanonical. The owner may select one successor through an explicit review.
Play into Prose asks a Scribe to shape selected session turns into a prepared
manuscript scene; the original log remains intact and the prose is committed
only through the normal reviewed writing transaction.

### 5. Deterministic solo-RPG tools

Provide system-neutral dice notation, likelihood oracles, weighted tables,
decks, user-defined fields, and progress clocks. Committed results are frozen
in Chronicle. The Scribe may interpret a recorded result but cannot roll,
reroll, or change it. A complete tabletop rules engine is not part of this
programme.

### 6. Editorial Desk

Add read-only developmental, scene, continuity, pacing, repetition, and
character-arc reviews. Findings form an issue ledger with exact page/turn
evidence. Protect locks identify prose or facts that proposed revisions must
not change. Applying any correction remains a separate owner action.

## Release discipline

Each step is independently migratable, documented, archive-safe, and gated by
backend/frontend tests plus existing CI. Later steps may consume earlier data,
but disabling or never using them must leave ordinary Desk, Chronicle, Codex,
Gallery, and Gate behaviour intact.
