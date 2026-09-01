# The Desk

PR 11 makes the Desk the complete page-level authoring surface while retaining
the durable writing transaction, revision, continuity, and recovery boundaries
introduced by PRs 03, 05, and 06.

## Reading and editing

The reader opens at the active tail and keeps page navigation separate from the
composer. Bracket keys turn pages outside form controls; Ctrl/Cmd+Enter invokes
the same primary writing action as its labelled button. Reading, narration,
painting, and upload controls live in a collapsible tool sheet. In portrait the
active composer sticks above the labelled workspace bar and remains in normal
document flow, so it does not permanently cover manuscript prose.

The current tail can be edited directly. Input is retained immediately in an
isolated Desk-session draft and autosaves after a quiet delay through the
canonical revision endpoint. The interface distinguishes unsaved, saving,
saved, offline, ordinary failure, and revision-conflict states. A successful
tail edit invalidates any prepared successor. A failed save keeps the author's
text; a conflict offers an explicit latest-revision load before another save.

Earlier pages offer **Copyedit this page** instead. This calls only the
display-copyedit endpoint and says plainly that canonical prose and Archivist
facts are unchanged. It never invokes an AI provider or continuity extraction.

## Writing states

The primary action reflects PR 06 exactly: directed writing, preparation in
flight, a ready prepared page, and reconciliation after interrupted replies are
distinct visible states. Prepared promotion accepts only the opaque prepared
identity and never falls back to a paid live generation. Direction is cleared
only after a successful current-story commit; cancellation, provider failure,
story switching, and stale replies preserve or isolate the author's work.

## Returning and recovery

On a historical page, **Return story to this page** names the exact later page
count and number range. Confirmation removes that suffix from the active chain,
unplaces its art, invalidates prepared work, and returns both a short-lived undo
token and a longer-lived recovery record. The Desk presents the immediate undo
without storing its token in browser persistence. If quick undo expires, the
recovery record remains available for Chronicle restore or export.

All storyless, empty, read-only, saving, provider, offline, conflict, and
recovery states use live text or status regions rather than color alone.
