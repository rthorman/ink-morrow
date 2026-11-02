# B6 — saved-text listening and immutable audio editions

Implemented on `recovery/b6-listening`, PR #114, based on canonical main `9395fcf`.
Application stays 5.0.0; appended schema 28 supplies immutable source plans, cache
metadata, durable jobs and disjoint synthesis call records. Final updated-head CI
and main integration remain pending; the earlier checkpoint at `a13e8ab` passed
all five checks while the PR was draft.

## B6 listening to saved fiction

Desk and Gallery offer **Listen to saved text**. Choose the configured MP3-capable
Narrator voice, Read aloud, Auto-read or an audiobook edition, and a saved passage,
path, chapter or volume. **Preview listening plan (free)** freezes that selection
and shows segment counts, cached reuse, maximum synthesis calls and exposure.
Only selected narrative prose goes to the Narrator: no Ask, private references,
owner directions, correction records or sibling paths. Generated prose itself may
contain fictional secrets; this is not semantic spoiler filtering.

A new purchase needs consent scoped to that immutable plan. Synthesis is sequential,
with no transport retry, recursive splitting or purchased PCM fallback. Read aloud
caps at 16 segments; Auto-read/audiobooks at 512. A unit caps at 16 MiB and an edition
at 512 MiB. Choose a smaller passage/chapter/volume if preflight rejects the range.
There is a 20-job installation queue and a conservative 4 GiB retained-audio quota.

The shared player keeps a labelled source, preparation progress, cancellation and
Return action across rooms. Pause/Stop playback differs from **Cancel remaining
synthesis**. Voice choice and playback speed are device preferences; changing speed
and replaying a cached edition are free. A story/path change pauses Auto-read and
requests cancellation of its remaining synthesis. A failed cancellation is reported
rather than treated as confirmation. Tap to resume handles browser autoplay refusal
without another purchase. Lock clears private playback UI.

Cancellation prevents undispatched units; dispatched work may still cost money and
produce reusable cache bytes. Restart interrupts unfinished work without automatic
resumption. Review a new plan to reuse completed units and purchase only permitted
missing units. A disappeared or corrupt reviewed cache hit fails instead of silently
buying a replacement. Retained job status shows known dollars and unknown-cost
attempts separately. A late status reply cannot revive a cancelled player display.

Audio editions retain their source and are labelled older when the selected path
has moved on. Download the MP3 separately. Private playable saves carry aggregate
spend but exclude synthesized audio, listening plans/jobs, credentials and resumable
purchase authority. Keep cold installation backups for configured database/media.

## Authority, limits and preservation

The source cut reads selected-ancestry prose and applicable editorial ranges before
queueing. Cache identities include text, provider/profile endpoint, model, voice,
format and settings version. Credentials resolve before each new claim and never
enter plans, files or saves. Cache metadata checks keep previews bounded without
reading all audio bytes. Actual reuse verifies size/hash; invalid membership is
removed without changing retained editions, and the old plan cannot buy a formerly
free unit. An explicit later preview can review a replacement.

One active job per story and one running worker installation-wide are constrained
in SQL. Claims are durable before dispatch. Cache publication and per-call settlement
are transactional; assembly writes sequentially to owned staging, then publishes
once. Cancellation/restart cannot revive a terminal edition. Already-dispatched
results may settle costs and retain cache independently. MP3 framing, byte bounds,
SHA-256 integrity, disk preflight and bounded download verification are technical
checks, not narrator-quality certification. Edition binaries remain outside saves.

Genuine synthetic schema-27 DB/baseline fixtures were captured before migration 28.
Upgrade and injected-failure tests preserve original ledger, game and beat bytes.
Earlier migration sources, frozen save-v1 semantics and old accepted prose remain
unchanged. No owner DB was opened and no production server was started.

## Verification and remaining qualification

Focused backend tests cover immutable sources, free replay, cancellation, restart,
unknown charges, known charges on malformed/oversized output, missing/corrupt cache,
private correction exclusion, cancellation fences and migration rollback. Frontend
coverage includes cancellation after closing the task, stale status after Cancel,
source-labelled playback across story changes and Lock. Browser fixtures use
explicitly synthetic silence, not a paid voice. They exercise plan review, one
preparation, decoding, free speed/playback, room return and Lock.

The prior saved checkpoint passed five CI checks. The resumed final source needs
its updated complete tests/CI before merge; record those results separately from
real Android, live voice and literary quality, which remain unqualified. Six source
manuals are updated. PDFs stay deferred until the final recovery checkpoint.
B7 finishing and the N1–N6 narrative tasks follow on updated main.
