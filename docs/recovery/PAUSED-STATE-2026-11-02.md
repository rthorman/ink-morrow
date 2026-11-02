# Paused development state — 2 November 2026

## Publication status — approved retry in progress

The owner explicitly requested another attempt after being asked whether to publish
this exact checkpoint to the public `rthorman/ink-morrow` repository. Local write
permissions are now available. The verified 34-file saved snapshot has been restored
to the existing B6 checkout, with the earlier local WIP archived before restoration.
The snapshot will be committed and pushed to `recovery/b6-listening`; main will not
be changed. Development remains paused. Verify the branch head and draft PR for
publication status; no B6 acceptance or five-green CI result is implied.

The earlier tree-upload approval rejection is historical. It was not bypassed;
publication is being retried after the owner's explicit response and updated
permissions. No owner data or credentials enter the checkpoint.

## Owner direction and authoritative checkpoint

Development is paused at the owner's explicit request: reach a useful checkpoint,
write full state and push; resume at a later date. Do not start more development,
merge, deploy or make paid provider calls merely because this handoff exists.

GitHub is canonical. Main is `9395fcf09f5fb9a55467c545ca5f2d72765b79ba`, the merge
of B5 PR #113 after five green checks at `c9801c6069620a4a01c0b852859e89925e76453b`.
B5 is delivered to source main, not deployed. Main remains application 5.0.0,
schema 27. The paused B6 work is a prepared, unpublished draft checkpoint intended for
`recovery/b6-listening`, based directly on that main, with application 5.0.0 and
appended schema 28. B6 is NOT merged or accepted as a finished batch.

The owner added the Character Forge-inspired ideas as development tasks before
asking to pause. `DEVELOPMENT-TASKS.md` retains B6/B7, N1–N6 and final qualification.
D1 wording edits, D2 old-series conversion, D3 image conditioning and optional B9
solo tools remain separate. Production startup/deployment and paid evaluation are
not authorized. Six PDFs remain deferred until final recovery completion.

## B6 implementation preserved in this checkpoint

- `backend/src/modules/fiction/listening-migration-v28.js`: immutable source plans,
  local audio cache, durable listening jobs and disjoint synthesis call records.
  One active job per story and one running worker per database are SQL-constrained.
- `listening.js`: free selected-path/ancestral passage, chapter or volume planning;
  configured MP3 narrator/voice validation; explicit start with durable action key;
  prepared-plan cancellation fences; bounded queue; restart interruption; job/status
  and authenticated download routes. No narrative beat is created by preparation.
- Source text, branch/head, profile/endpoint, model/voice/format and cache identity
  freeze before queueing. Only selected saved narrative prose is synthesized; Ask,
  owner directions, local corrections, private references and sibling paths are
  excluded. An edition can finish independently of later narration.
- Read-aloud caps at 16 segments; audiobook/Auto-read at 512. Sentence splitting
  uses the retained 1,800-character splitter, without recursive retry. Segment
  bytes cap at 16 MiB; assembled editions at 512 MiB. Disk-space/quota checks occur
  before dispatch. Assembly writes sequentially to operation-owned staging rather
  than buffering a whole edition. Download integrity uses bounded file reads.
- `mp3.js`: MPEG Layer III frame-boundary and optional ID3 framing validation.
  This is technical validation, not a speech/literary-quality claim. Cache and
  edition bytes have SHA-256 integrity records; browser decoding remains explicit.
- `backend/src/ai.js` adds `noRetry` for the new listening transport. New listening
  uses one attempt and no MP3/PCM fallback; retained legacy behavior stays separate.
- A cache hit makes no synthesis call. A hit that later disappears cannot silently
  become a new purchase under its old review. Cancellation prevents undispatched
  units; an already dispatched call can still settle cost and retain validated
  cache bytes without reviving a cancelled/interrupted edition.
- Known cost and unknown attempts are preserved separately, including malformed or
  oversized charged output. Original-provider cost lookup cannot be redirected to
  a changed narrator endpoint. Story spend unions audio calls once with narrative,
  art and imported charges; job summaries are not added again.
- Playable saves carry aggregate spend, but exclude synthesized audio, plans/jobs,
  cache configuration, credentials and resumable authority. Audio downloads remain
  separate installation-local artifacts.
- `frontend/app/fiction/listening.js` adds explicit free plan preview, plan-scoped
  paid consent, retained-job recovery, playback/download, cancellation and a shared
  player. Playback speed and voice preference are device-local; speed/replay buy
  nothing. Latest controls keep preparation progress/cancel available after the
  dialog closes. Story/path changes pause/cancel an Auto-read source; Lock clears
  private playback UI and fences late callbacks. The final persistent-controls
  change needs the fresh full browser regression listed below.
- `app.js` adds Desk/Gallery listening entries and refreshes story spend on job
  settlement. Root API composition disposes/reconciles the listening runtime.
- Synthetic genuine schema-27 DB/baseline fixtures were captured before migration
  28. Migration tests compare old ledger/game/beat bytes and injected rollback.
  No owner database was opened or migrated.
- Inherited audiobook tests now remove their own regular files rather than trying
  to unlink the new fiction-audio subdirectory. Existing current-schema assertions
  were advanced to 28; historical rollback targets remain explicitly pinned.

## Verification: exact limits of the evidence

Before the pause:
- B5: all five CI checks green, 57 desktop and 57 mobile journeys passed; merged
  PR #113 as above. Existing B5 source/manual records may still use provisional
  language; this state supersedes that status.
- Initial B6 complete backend run: 553 passed, 15 failed, 568 total. All 15 failures
  came from inherited audiobook fixture cleanup treating the new directory as a
  file. That cleanup was corrected; its targeted 15-test rerun passed.
- Targeted combined audio run passed 28 tests (new listening, transport, legacy
  audiobook) before the last three edge-case additions.
- Desktop and mobile B6 browser journeys each passed using an explicitly synthetic
  silence MP3, with mocked provider HTTP boundaries. They exercised one reviewed
  preparation, browser decoding, free playback speed/replay, room return and Lock.
  These preceded the latest persistent progress/cancel controls; do not claim those
  exact final UI changes have passed a fresh browser run.
- Full frontend run passed 336 cases before the latest progress controls.

At the final pause checkpoint, in an isolated Linux scratch snapshot:
- Lint passed.
- Full frontend suite passed all 336 cases in 37 suites, including the latest UI.
- Targeted listening and transport suites passed 16 cases in two suites, including
  known charges on rejected/oversized output and exclusion of secret correction
  content from speech. A test fixture's invalid `visibility: private` was corrected
  to the product's `secret` enum in this pushed snapshot.
- Logs are retained under `docs/recovery/evidence/b6-checkpoint/`.

No final full backend/browser run or five-green exact-head B6 CI acceptance is
claimed. Draft PR CI may run after the push; inspect the actual final commit and
job conclusions at resume. No real Android IME/rotation, live voice quality,
long-form literary quality or production-migration acceptance was observed.

## Local checkpoint restoration

The original local permission reviewer timed out before writes, and the first
GitHub connector tree publication was rejected. A verified portable ZIP preserved
all 34 checkpoint files and hashes in the chat's outputs directory.

On the owner's explicit retry, the saved ZIP was hash-verified and compared with
`/home/rthorman/src/ink-morrow-5`. Only the expected fixture correction and handoff
files differed. Before restoring that snapshot, the original local diff and source
files were archived under this chat's `work/b6-before-publication/` directory. No
hard reset, production change, owner-data deletion or new feature work was done.

The existing `recovery/b6-listening` checkout now contains the restored snapshot,
including the corrected `secret` visibility fixture and full pause/task records.
After publication, use the GitHub branch as canonical and preserve any later local
changes before updating. Do not reapply the older pre-checkpoint WIP over it.

## Concrete remaining work, in order

1. Inspect the published B6 draft branch/PR head and CI, preserving any later local
   changes. Resume only after a new explicit owner request.
   Run final full backend, frontend and desktop/mobile browser checks on that exact
   source, using isolated data and fixtures. Review persistent preparation controls,
   cancellation after closing the dialog, missing-cache behavior, queue/restart,
   MP3 framing, size/disk limits, source privacy and aggregate spend.
2. Add any missing focused coverage for the final persistent player controls and
   source/range/queue boundaries. Complete visual/accessibility review and B6 source
   manuals/delivery record. Do not count prompt or synthetic-audio checks as live
   voice-quality evidence. Keep PDFs deferred.
3. Complete B6 only through an exact-head five-green PR/main merge; prune only its
   integrated branch. Then start B7 on updated main.
4. B7: frozen book previews/jobs, common nine-format publication source, durable
   retained Bookshelf and fully functional current-fiction share sub-slice.
   Preserve complete local export when hosting/sharing is unavailable. Sharing
   must use a new immutable current-fiction adapter, not retired story APIs.
5. N1–N6: implement the queued memory/repertoire/desire-tactic/chapter-handoff work
   using existing generation calls/context first. Maintain branch evidence, whole
   characters, knowledge/privacy and inhabited-player agency. No new planner or
   critic calls are authorized. Retain the evaluation counterexamples.
6. Finish B8 qualification/capability ledger/release notes, update every affected
   manual source, remove the PDF deferral, regenerate and inspect all six books and
   their manifest. Real-device and paid literary evaluation remain separate,
   honestly recorded limits. Finish with verified merged main and clean checkouts.

## Character Forge source ideas retained as tasks

Read-only source inspected at `36dd2db` in `rthorman/character-forge`:
`server/chat/context-memory.js`, temporal retrieval/report, scene-continuity guide,
narrator stewardship, continuing desires/tactics and development/breadth reports.
The practical ideas are: persistent truth is distinct from current attention;
whole-character anchors remain authoritative; initiative has a desire, feasible
method, observable act and consequence; tactic outcomes change subsequent choices;
ongoing relationships develop through milestones; chapter handoffs retain causal
momentum without promoting plans into completed facts.

Important counterexamples remain: repeated rejected compensation bids and a
possession-grounding error despite recent history. Short controlled improvements
are not proof of sustained transfer. N6 retains full rolling sequence evaluation
and failure evidence, without authorizing a paid experiment by itself.
