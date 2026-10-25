# UI/usability review of recovery implementation guide 0.1

Reviewed 25 October 2026. Read the complete 442-line, 7,550-word guide and checked the active reader, studio, media, dialog and publication implementations, retained shell/settings/Bookshelf/narration patterns, brand specification and existing browser checks. This is a source/design review; no app, server or live provider was run. Only this review document was written.

## Assessment

The guide has the right product direction. Preserve the separation of reading and action targets, narrative and local records, references and facts, reader-safe and private planning views, and books and playable saves. Keep the bounded outline instead of a mandatory graph canvas, no automatic audio/prose purchases, exact frozen editions, explicit candidate acceptance, and real-device evidence. These are strong foundations.

The main remaining risks are inconsistent screen behavior between those contracts, incomplete tablet geometry, and a delivery sequence that could install navigation before restoring the tasks it promises. The following findings require guide changes, not a new user decision. High means a likely loss of work, wrong-context action, unusable tablet state or incoherent intermediate release; medium means material workflow or acceptance ambiguity.

## High-priority findings

### UI-01 — Specify the shell's scroll and keyboard ownership

**Guide:** 7.2–7.3, B0/B1, 20.2.

“Reachable action strip,” five bottom room controls, dynamic viewport height and “avoid two fixed bottom rows” do not yet describe one implementable layout. Developers could append two fixed bars to the current document, preserving its excessive vertical stacking and then covering the focused field with Android's keyboard. The current HTML already requests `interactive-widget=resizes-content`; that is a useful prerequisite, not evidence that the new composition fits.

**Add required behavior:**

- Normal portrait Desk uses one shell grid: compact identity/header, a `minmax(0, 1fr)` reading region, compact action row, labelled room bar and safe-area padding. The reading region owns the passage scroll. Neither bottom row overlays prose; both consume measured layout space. Do not retain the old document-sticky pagination plus an independently fixed composer.
- Steer/Ask opens one full-height task sheet on tablet. That task replaces the compact action row and makes the underlying room bar/reader inert. The sheet has a compact Close/target header, one scrolling form body and a submit/status region within the available visual viewport. Opening the keyboard must not add another fixed footer or leave submit behind the IME.
- Closing a task retains its draft and restores the same reader anchor. Android Back first dismisses the keyboard when the platform does so; subsequent Back closes the task through the normal route/dirty policy. It must not submit or discard.
- At enlarged text or very short visual height, use a scrolling flow fallback instead of clipping an exact-height grid. Every field, error, action and Close control remains reachable. Landscape uses a rail only when the remaining inline space supports the prose; an inspector becomes a drawer before it compresses the column.
- Reserve actual image dimensions/aspect ratio so lazy artwork does not move restored text after loading. Test reader, task-sheet and image-loading scroll behavior separately.

**Evidence:** [active viewport and reader markup](../../../frontend/index.html), [current sticky pagination and flowing composer](../../../frontend/styles/fiction.css), [retained safe-area/rail implementation](../../../frontend/styles/shell.css).

### UI-02 — Make the action matrix complete, including local mutations

**Guide:** 4.1, 5.2–5.3, 8–10.

The table handles historical generation but leaves non-active-path browsing, no-prose stories, ended episodes and local changes from historical inspection unspecified. A user can inspect an old fact and press Correct or edit a reference; that must not silently mutate an unseen latest target. The Inhabit row can also be read as replacing Follow with compulsory Act/Say.

**Replace/extend the Desk matrix:**

| Situation | Required behavior |
|---|---|
| Custom situation, no narrative passage | Show the established situation, “No passages yet,” and Continue story. Do not fabricate passage 1 or offer an empty Latest target. |
| Narrative head, outside cast | Continue, Steer and Ask remain available. Selecting a mode gives it a matching primary action and draft. A typed Steer draft is never silently ignored by a nearby unqualified Continue button. |
| Inhabit active | Continue can develop the surrounding scene. Act/Say are additional explicit contributions. The named role and Release remain visible; Inhabit does not force a contribution every turn. |
| Older passage on active path | Return to latest and Explore from here replace ordinary generation. A correction/reference/editorial operation explicitly targets the current head or first creates a path from the inspected moment. Its review names which, without changing the reading cursor. |
| Another path is being browsed | Mark it as browsing. “Make this the active path” is a free, revision-checked selection command before a paid action. If another path has pending narrative work, browsing continues while activation is unavailable with a reason. Preserve drafts belonging to both paths. |
| Episode ended | Show its resting-point summary and Begin another episode. Do not expose an enabled contribution that the server must reject. |
| Provider missing/unavailable | Keep reading, local operations and drafts usable. Explain the unavailable paid action and provide Settings with a return descriptor. |
| Job completes after user moved away | Show a result-ready notice associated with the operation. Do not move the cursor or steal focus; jump/open is explicit. |

Hide/disable the direction-scope selector for Ask, Act and Say; retain each mode's draft independently. A stale-target review must offer Return to target, Retarget this draft and Cancel; retargeting never submits. Keep narrative action-head identity distinct from the latest narrative passage when a local record is the true branch head.

**Evidence:** [current control blocking, pagination and reset behavior](../../../frontend/app/fiction/app.js), [current optional control and direction fields](../../../frontend/index.html).

### UI-03 — Give historical truth and presentation separate explicit query state

**Guide:** 4.1, 5.2, 6.1, 9–10, 14, 16.

The guide correctly asks for current-path artwork on ordinary rereading and “As it was” on request. However, `/passages/:beat?branch_id=` cannot identify the chosen presentation boundary, and `at` has no explicit meaning across truth inspection, Gallery and book edition selection. `cursorBeatId` is narrative-only, so it also cannot represent selecting an Ask or a correction in Chronicle.

**Required contract:**

- Keep `cursorBeatId` as a narrative passage. Add `selectedHistoryBeatId` for any timeline entry, `inspectionAtBeatId` for the state being inspected, `presentationMode` (`current-path` or `historical`) and a resolved `presentationHeadBeatId`.
- Default Codex/evidence opened from a passage to public knowledge as of that inspection moment. Label the boundary (“As of passage …”) and offer an explicit Latest state action. Do not silently show future knowledge beside old text.
- Passage/asset queries accept an explicit validated presentation boundary/mode and return the resolved presentation revision/head. Current-path mode resolves the selected path's present overlays; historical mode resolves the inspected snapshot. Both preserve the original source and reject unrelated ancestry.
- The same passage shared by two paths can legitimately show different current art/wording. Cache keys must include the resolved presentation identity, not just passage ID.
- Gallery labels the selected placement edition. Historical inspection is read-only; “Edit current path presentation” deliberately changes target. Gate names its chosen path/head plus presentation and structure revisions before freezing a preview.
- Selecting an Ask entry opens Q&A with its own selected-history identity while retaining the nearest narrative anchor. It never requests that Ask through a narrative-only passage endpoint. Selecting a local correction opens its state-change/evidence inspector.
- Ask completion leaves narrative ordinals unchanged, even after reload, earlier-window loading or switching paths. “Latest” for narrative navigation means the latest narrative passage, not the latest local/Ask record.

For bookmarks, store the effective display revision along with the paragraph anchor. Restore exactly when that revision matches. If wording changes destroy the anchor, explain the fallback to the passage start/nearest verified surviving anchor; do not promise an exact match without an anchor mapping. Image load must not invalidate a restored anchor.

**Evidence:** [current reading pages include clarifications](../../../frontend/app/fiction/app.js), [current public response uses active state and its images](../../../backend/src/modules/fiction/store.js), [current book projection excludes clarifications](../../../backend/src/modules/fiction/publication.js).

### UI-04 — Prevent the first shell delivery from moving or hiding working features

**Guide:** 7.1, 18–19, I14.

B1 promises the shell; Chronicle/Codex arrive in B2, Gallery in B5 and Gate in B7. Hiding unfinished rooms prevents placeholders but does not deliver five stable rooms and risks making today's art, correction or export features inaccessible. The guide needs a concrete integration/cutover rule.

**Recommended B1 replacement:**

> B1 supplies a useful adapter in every room before the new shell is enabled. Desk uses current reading/contribution actions. Chronicle exposes current paths, a bounded loaded-history list and existing alternative-path actions, honestly labelling incomplete windows. Codex exposes current public references/cast/facts, recall/evidence and corrections. Gallery exposes current cover/reference/passage images and the existing target-aware upload/paint workflow. Gate exposes existing readable-book export and private save download. B2–B7 deepen these workflows without removing them. New features remain capability-gated, but working rooms do not disappear.

If that adapter work is deliberately deferred, mark B1 as internal-only and define the minimum complete five-room cutover milestone. Do not call B1 a user release. B0 should prototype real state transitions and failures for these adapters, not only five populated screenshots.

Add a room ownership table: Chronicle owns path/editorial/episode operations; Codex owns evidence, corrections and local reference/craft editing; Gallery owns image creation/placement and audio-edition management; Gate owns book/save/share preparation; Desk owns reading, contributions and playback transport. Shortcuts use those same controllers with a target and return descriptor. No reduced duplicate form in a second room.

### UI-05 — Draft persistence cannot require an existing story and branch

**Guide:** 4.3, 6.2, 11; B2/B3.

The proposed draft record/key requires owner/story/branch/type/target, but two critical tasks precede those identities: new-story setup and reusable catalogue creation. The guide currently promises recoverable studios and setup handoffs without a valid persistence scope for either. Candidate arrival and subsequent local edits also need a precise merge rule.

**Add required behavior:**

- Use a validated draft-scope union: story contribution, new-story setup, catalogue new/edit and story-reference revision. A new-story/catalogue draft has its own opaque draft identity, not a fabricated story/branch. Catalogue editing binds the saved entry revision. Story-reference editing binds the branch/reference revision.
- New-story setup retains selected opening/situation, optional references, added cast and advanced values across catalogue/studio navigation, reload and Back. “Add to this setup” returns to the same setup draft, showing the chosen item without starting a story. No provider setup is required to create a situation or edit references locally.
- Keep saved baseline, current working fields, candidate fields, candidate seed revision and the snapshot before candidate acceptance separately. A late candidate never overwrites fields edited after its seed was sent. Show Changed since request and allow field-level acceptance against the current values.
- “Restore previous fields” restores the pre-acceptance snapshot, with a warning if further edits would be replaced; it does not erase unrelated later edits silently. Unchecked fields stay unchanged. A save conflict preserves baseline/local/server versions for comparison.
- Distinguish Draft saved privately from Entry saved and Applied to this story. Autosaving a draft does not save a reusable entry or mutate a story reference. Closing a recoverable draft should ordinarily say Close/Keep draft; Discard is a separate explicit action.
- Native selected upload files are transient and cannot be restored as `File` input state after reload. Either stage a validated private candidate asset with clear lifetime or say the file needs reselecting; retain the other fields. Do not claim full recovery of an unstaged native file.

**Evidence:** [current studio replaces form values from AI results](../../../frontend/app/fiction/library.js), [current new-story form and setup loader](../../../frontend/index.html), [current setup selection preservation is in memory](../../../frontend/app/fiction/library.js).

### UI-06 — A return descriptor needs a lifecycle and a real modal implementation

**Guide:** 3, 6.3, 7.1/7.3; B1/B2.

The existing shared dialog manager replaces an open shared dialog rather than stacking shared tasks. It restores the currently recorded DOM opener and resets panel scrolling when reopened. Merely reusing it does not preserve a studio → paid review → studio sequence, or a memory search → evidence → correction sequence, through navigation and rerendering.

**Add a module contract and navigation behavior:**

- The router owns normalized navigation context. Room modules expose `enter(context)`, `leave(reason)`, `dispose()` and an optional view-state snapshot, and unsubscribe their own listeners. Loaders produce data; only the current lifecycle context may paint/focus. The shell owns the selected story and navigation, not room-local copies.
- A return descriptor contains origin route/room, story/view path, narrative cursor/anchor, selected history/item, query/filter/page window, open task/draft identity, and a semantic focus target. It contains identities and view state, not duplicated private prose.
- Ordinary room changes push history; passage turns replace it. Task open/close and browser Back restore one prior task state without repeated history entries from polling. Invalid/deleted origin items fall back to the room heading with an explanation.
- Full-page studios retain their own state while a short review dialog is open. Alternatively extend the shared manager with a bounded suspend/resume task mechanism; do not create a parallel focus/scroll implementation. Review cancellation restores the same form scroll, field and selection, not a newly rebuilt top-of-form view.
- Room entry focuses the room heading; explicit passage turns can focus the prose heading; closing an inspector restores its semantic opener. Passive refresh/progress never moves focus. Lock clears private tasks and removes their return state; unlocking does not resurrect a private overlay from stale history.
- Pending jobs must not make an entire long-lived task uncloseable. Closing is distinct from cancelling undispatched work; no close control claims to cancel dispatched purchases.

**Evidence:** [shared `openDialog`/close behavior](../../../frontend/app/core/dialogs.js), [current route force-closes dialogs](../../../frontend/app/fiction/app.js).

## Medium-priority findings

### UI-07 — Restore Settings as a scoped workflow, not only a route

**Guide:** 7, 11–12, 15, B1/B3/B6.

There is no concrete Settings surface contract. The active app offers provider forms and three reading sizes; retained settings provide font choices, group summaries and speech choices. Add a Settings section and assign each part to a batch:

| Group | Scope and behavior |
|---|---|
| Reading | Device-only typeface, size, line spacing, width and accessible paper/ink theme; live sample and Reset. Persist only non-private presentation settings. No graph mutation. |
| This story/path | Summary and link to the single local creative-settings editor. Clearly label branch-local values versus global defaults; show which future narration changes. |
| Providers | Role readiness, searchable/catalogue model choice where supported, credential/vault state, exposure and configuration-specific purchase-consent review/reset. Preserve the originating task on return. |
| Listening | Read-aloud voice, model and playback speed are separately labelled. Local speed changes do not synthesize a new file. Voice/model changes select a different cache identity for future purchases. |
| Access and help | Lock, working password change, backup/help links and user manual. Do not assume calling the existing account wiring creates its missing form markup. |

Reading preferences belong in B1; story configuration in B3; functioning speech controls in B6. Do not expose controls for unimplemented capabilities as if they work.

**Evidence:** [active Settings markup](../../../frontend/index.html), [retained grouped settings](../../../frontend/app/features/settings.js), [account wiring requires existing form markup](../../../frontend/app/features/auth/gate.js).

### UI-08 — Define Library, setup and Bookshelf collections

**Guide:** 7.1, 11, B0/B3/B7.

Specify a canonical new-story route and its optional setup disclosure flow; the guide currently gives `#/new` as an alias without defining its destination. Preserve both curated openings and a custom situation, no avatar requirement, local start and optional references. Show explicitly whether extra references supplement a curated opening; do not silently replace its authored cast/facts. Title fallback can be local; it must not create an unannounced AI call.

Library should provide Resume (saved bookmark), Latest (head), Catch me up (free recap), Start and import/restore with clear distinction. Cards show title, cover/status, path/episode, recent public context and local/pending state. Search/filter/pagination must preserve their state when a card task returns. A missing cover is an honest placeholder with an optional Add cover shortcut.

Define Bookshelf as an authenticated aggregate of retained book editions, audiobook editions and story art, with filters and links to the owning story/edition. Clearly mark private reference art; it is not automatically part of a reading copy. Include source/path/edition, ready/interrupted/missing status, playback/download and current-versus-older edition labels. It queries stored artifacts; loading it never builds them. Use a bounded aggregate query, not per-story full downloads. The retained Bookshelf is evidence for this purpose, not a current API to remount.

**Evidence:** [retained all-story media Bookshelf](../../../frontend/app/features/library/bookshelf.js), [active shelf and scenario creation](../../../frontend/app/fiction/app.js).

### UI-09 — Specify image creation, preview and placement as separate task states

**Guide:** 5.3, 14; B5.

The guide allows an image job to complete independently, then stale-checks attachment. Without a screen transition, a successful paid image could look lost when the story advances. Add:

> Upload/Paint first creates a ready collection asset. Its task preserves the originally reviewed target and shows a real local/result preview. Attaching to that target is a local placement operation. If the target is unchanged, an explicitly reviewed conditional attachment may complete; otherwise show “Image ready; not placed” with Preview, Place on current path, Choose another target and Keep unplaced. Never repaint to repair attachment failure. A failed placement does not discard the asset or its charge record.

Before replacing, show current image and candidate with target passage title/excerpt; state that the existing image remains in retained historical use. Placement preview represents reader-before-passage and EPUB-separate-page behavior. Removing a placement and deleting an unreferenced asset are distinct actions with explicit consequences. Image selection displays public/current use separately from historical retention; no giant list of opaque snapshot IDs.

Upload should preview the selected file before submission, retain alt text after a technical error and explain whether file reselection is necessary after reload. Paint remains visible when unavailable, with its reason and Settings return; upload stays usable.

### UI-10 — One playback controller must survive room navigation predictably

**Guide:** 8, 15; B6.

The server job plan is strong, but the frontend transport lacks ownership and navigation rules. Add one workspace playback controller. Desk, Gallery and Bookshelf provide views of it; they do not each instantiate players or dispatch the same synthesis.

Default: room changes keep the same explicit playback, with a compact labelled Playing edition/passage transport and Return action. Changing story or path pauses autoplay/Auto-read before any undispatched purchase. Already-paid finished audio stays available. If the product chooses to continue playback across story changes, it must retain a plainly labelled original source; it must never rebind silently.

Distinguish Pause playback, Stop playback and Cancel remaining synthesis. If Auto-read follows the displayed text, make that an explicit setting; manually inspecting another passage stops automatic viewport following while the original frozen run remains identified. Reaching the planned last passage stops, even if new prose has since arrived. Treat browser autoplay rejection and lost audio focus as “Tap to resume,” never a reason to repurchase. A pending/failed preparation can coexist with previously cached audio playback.

**Evidence:** [retained stateful narration transport](../../../frontend/app/features/write/narration.js). Its original automatic page-flip semantics need adaptation, not direct reuse.

### UI-11 — Make Gate preview and sharing complete on an Android tablet

**Guide:** 16; B7.

Specify that Gate starts from the selected viewed path/edition, prominently names it, and does not silently select the global active path. Preserve metadata/preset fields while an immutable preview builds. Show contents, art thumbnails/alt text, counts and exclusions; changes after preview mark it out of date and require a new preview. An existing frozen preview remains downloadable as that edition.

Allow selecting one or several supported formats against the same snapshot. Show per-format completion/failure and retry local rendering without buying AI. Preflight errors link back to their correct passage/asset and preserve the Gate draft. Distinguish rendering a book from fetching an already ready file. A browser download acknowledgement is not proof that the user saved a file successfully; use truthful UI copy.

Sharing needs source preview, expiry selection, explicit creation, selectable/copyable revealed URL with a fallback when clipboard APIs are unavailable, active/expired/revoked listings and revocation. Use metadata that makes the share identifiable after the capability is no longer displayed. Revocation prevents future access; it cannot retract downloaded copies. When hosting cannot make the share accessible, explain the actual limitation and keep local export complete; do not show a fake success or disabled promise.

### UI-12 — Make the brand spec a reusable composition contract

**Guide:** 7.2, B0.

“Strong Scriptorium composition” is too open to reproduce the same generic panel layout with richer gradients. Add a small implementation table:

| Surface | Concrete composition |
|---|---|
| Library/threshold | Art-directed portrait/landscape/desktop hero using the supplied corresponding artwork, real HTML copy in its safe region or a separate panel, Resume/Start in the first viewport. Cap the art to fit the task; do not copy the old huge header/hero stack. |
| Studios | Image/portrait preview plus identity/depth/craft sections, material section hierarchy and one persistent action region. Dense fields never sit over figures. |
| Chronicle/Codex | Restrained archival surfaces, gold hierarchy markers and evidence cards; optional small existing archival art at thresholds/empty states. |
| Gallery/Bookshelf | Media-led previews, truthful edition/placement badges and a clear collection/detail distinction. |
| Desk | Quiet opaque reading paper, manuscript typography, limited edge atmosphere; cover art does not displace the first passage. |

Map existing tokens to background/material/ink/paper/primary action/selected path/focus/danger. Preserve oxblood primary-action character and scarce gold/witchlight emphasis rather than making every control ornamental. Use the canonical logo asset, bundled display/UI/reading fonts and existing artwork; this recovery spec should not depend on buying new images. Critical warnings, costs and destructive reviews remain plain and highly legible.

**Evidence:** [approved brand responsive compositions](../../../InkMorrow-OpenCode-Branding/INKMORROW-FRONTEND-BRAND.md), [approved quiet-prose art rules](../../releases/4.0.0/ART-DIRECTION.md).

### UI-13 — Turn device evidence into discriminating acceptance checks

**Guide:** 20.2–20.3, 22; B0/B8.

Keep the real Android requirement, but define its evidence so a screenshot or passing overflow assertion cannot substitute for task success. The current narrow-layout test changes prose to 24 px and checks document width/visibility; it does not establish 200% interface enlargement, a real IME, focus return or touch reachability.

Add a named populated fixture containing a long title, at least two paths sharing early passages, Ask/local history records, a pending response, retained draft/candidate, a tall illustration, missing media and both ready/interrupted audio editions. Record hardware/browser, orientation, actual visual viewport with IME, text settings and steps. No live paid call is required: fake transports can hold and resolve work.

Required recordings/checks:

1. At both tablet postures, reach and activate every room and primary action by touch; targets have actual 44 px hit areas. No hover or precision-only control.
2. Open Steer, type, open/close the keyboard, rotate, visit Settings, return, cancel a review and reload. Target, text, scope, form scroll and reader anchor remain correct.
3. Browse another path during pending work; resolve it; verify no unsolicited jump/focus, wrong-story paint or second paid request.
4. Follow a relationship through search, evidence and correction, then Back through the same query/results/focus. Repeat with a missing/deleted return target.
5. Change current artwork/wording on one path; inspect shared older text on both paths and in As it was; verify labelled, correct presentation and stable narrative ordinals despite Ask entries.
6. Exercise 200% browser zoom and Android text enlargement as supported and document which was used. Test controls/labels as well as prose. Use real keyboard input and virtual-keyboard resize; a shorter desktop viewport is only supplemental evidence.
7. Try interrupted upload/job/rendering, native picker cancellation, browser audio-play refusal and clipboard-unavailable sharing. Confirm a useful recovery action and retained drafts/assets.

Do not require that every primary action remains simultaneously visible at enlarged text; require that it remains reachable without horizontal document scrolling, hidden overlap or loss of context. Record automated mechanics, populated visual approval and real-tablet task evidence separately.

**Evidence:** [existing reflow assertion](../../../e2e/tests/fiction.e2e.test.js).

## Decisions and completion

No additional stakeholder decision is necessary to address these findings in the guide. D1 optional copyediting and D2 old-series conversion remain explicit implementation gates; neither blocks documenting the shell, inspection, studio, media or finishing workflows. Cross-device bookmark synchronization and image conditioning can remain deferred as already proposed.

The recommended room adapters, draft scopes, focus contract, playback default and tablet task sheet are routine concrete design resolutions. B0 should validate/refine their geometry and labels on the owner's Android tablet before implementation is accepted. They should not be left as unspecified choices that recreate the current experience.

Review complete. No implementation is continuing.

## Final consistency pass — refined draft 0.2

Read the complete 601-line refined guide and the cross-discipline disposition record on 25 October 2026. No remaining planning-blocking UI/usability contradiction was found. The combined contracts now connect reading versus action authority, historical knowledge versus presentation edition, useful five-room cutover adapters, pre-story draft recovery, candidate comparison, task suspension/Back/focus, media attachment and frozen publication workflows. Private book delivery remains independent of audio/sharing, and optional participation remains intact. The explicit D1 source choice and its semantic limitation are adequately labelled as an implementation policy gate; they do not block this planning document.

This is planning consistency acceptance, conditional on the specified B0/B1 populated design and relevant-batch device checks. It is not visual or real-device approval. Validate actual Android IME/Back behavior, rotation, interface enlargement, task-sheet scroll/focus restoration, accessible contrast and current-versus-historical source labels on the implemented prototype. Verify that the first cutover preserves every existing workflow, and that users can identify the path/target and distinguish a readable edition from a private playable save. The guide already requires that evidence; no additional stakeholder decision or guide replacement is requested.

Final pass complete. Only this review was appended; no app execution or implementation is continuing.
