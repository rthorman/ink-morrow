# Behavioral and HCI review of recovery draft 0.1

Reviewed 25 October 2026. Scope: the complete implementation guide and targeted current source; documentation only. No application changes, runtime tests, servers, paid calls, deployments or merges. This is an AI design review, not a clinical assessment or a user study.

The guide provides a strong shared-workspace contract. Its main remaining weaknesses concern the exact transitions between drafting, reviewing, submitting, leaving, reconciling and trying again. Those transitions should be specified before the corresponding implementation batch. None blocks completing and refining the documentation now.

Severity: **High** means resolve before the owning batch can be accepted because the omission risks lost work, an unintended purchase, a wrong target or a capability regression. **Medium** means complete the task contract before enabling that feature. Findings describe design gaps, not proof that the stakeholder has encountered each failure.

## 1. High — absence of a request is not proof of no dispatch

**Guide:** sections 5.3, 6.2 and 13.

Section 13 correctly adds durable action identity and free reconciliation, but its “no request dispatched” case does not distinguish an authoritative terminal outcome from an absent lookup record. A delayed original submission can arrive after a free lookup reports no record. Creating another key at that point could authorize two distinct purchases. The guide also does not bind the submitted copy of a draft to a specific durable draft revision; later editing can make exact recovery ambiguous.

**Evidence:** current `frontend/app/fiction/app.js:292` generates a new key at submission. `backend/src/modules/fiction/store.js:224` enforces same-key/fingerprint replay but different keys are distinct actions. These safeguards do not make an absent status row a terminal outcome.

**Add to section 13:**

> Before any paid dispatch, retain an opaque client action key and bind it to the exact submitted draft revision, contribution kind/scope, reviewed plan and target. Preserve that submitted revision separately from the editable next draft. Store private submitted text on the authenticated server, not in browser persistence. A status lookup distinguishes registered/pending, succeeded, terminal failure, and unregistered or unknown. An absent record or unavailable lookup is uncertainty, not permission to invent a replacement key. Recovery may explicitly resubmit the original command under the original key and identical fingerprint, with application-level replay checked before any dispatch; this never retries a provider transport call. Alternatively, a server-confirmed cancellation fence must prevent the original key dispatching before a replacement action is permitted. A terminal failed/interrupted action needs a new deliberate submission and a new key. Successful replay returns its original result before provider availability or current-head checks.

> Clear or mark submitted only the matching draft identity and revision. Never clear a later draft because its text happens to match the submitted text. If the user has edited meanwhile, retain that newer draft and identify the completed submission separately.

**Acceptance:** delay the original submission until after an absent lookup, reload, recover the original action, then release both network deliveries. Exactly one provider dispatch and one result occur. Later draft edits survive reconciliation. A failed status lookup never enables an automatic fresh purchase.

## 2. High — durable drafts need honest saving, lock and offline states

**Guide:** sections 4.3, 6.2, 6.3 and 7.3.

A debounced server draft plus an in-memory offline buffer cannot guarantee the latest keystrokes survive immediate reload or lock. “Lock cancels draft writes” also overstates what can happen to an already dispatched save. Without visible acknowledgement, users can reasonably confuse entered work with recovered work.

**Replace the opening and lock clauses of section 6.2 with:**

> Draft status is Saved on server, Saving, or Not yet saved — connection unavailable. Only an acknowledged draft revision is promised to survive reload. Debounce writes but attempt a final authenticated flush on ordinary task navigation; keep the task recoverable if acknowledgement is lost. Page-hide flushing is best effort and does not change this guarantee. While disconnected, preserve the pending buffer while the unlocked page remains open and provide a local copy/download option. Do not claim this buffer survives a browser close.

> Lock immediately hides and clears private client content, cancels unsent timers and invalidates callbacks; it never waits on a network response or a dirty confirmation. An already dispatched authenticated draft save may complete. The next unlock reconciles its revision without restoring private content before authentication. If the latest input was not acknowledged, only the last acknowledged server draft is guaranteed. Show that limitation beside the draft while it matters, rather than interrupting Lock with a permission prompt.

**Add to section 7.3:**

> Recoverable task sheets distinguish Close task from Discard draft. Closing preserves an acknowledged working draft; explicit discard removes it using a revision-checked local command. Failed or ambiguous discard reconciles before reporting deletion. A save error leaves the task and entered fields available. A late save or candidate result never reopens a closed task or steals focus.

**Acceptance:** cover immediate navigation, reload before acknowledgement, offline typing, response loss, lock during an unsent debounce and lock during an already dispatched save. Assert both privacy and the exact recoverable revision. Do not test unconditional offline durability that the design does not provide.

## 3. High — new-story setup and reusable studios have no story/path draft key

**Guide:** sections 4.3, 6.2 and 11.

The draft record and recovery scope are described through owner/story/branch/type/target, but an uncreated story and a reusable-world studio do not have a story/path. These are precisely the long, creative tasks whose loss would undermine the recovery. Section 11 promises preserved setup handoffs without defining their ownership or successful-create reconciliation.

**Add to sections 4.3 and 6.2:**

> Draft identity supports three resource scopes: new-story setup, reusable catalogue creation/editing, and existing-story/path work. Each has an owner-scoped stable draft ID and draft revision; story, branch and entity identities are optional according to scope. Existing-resource drafts record their saved base revision. New-story creation consumes a specific setup-draft revision through an idempotent local create command; response loss reconciles to the created story before another creation is allowed. Use in a new story and Add to this setup carry the setup draft ID and return descriptor. Cancelling the handoff returns to that exact setup without discarding its other choices.

> An explicit successful creation clears only the consumed setup-draft revision. Concurrently edited fields remain a separate draft. Catalogue drafts and setup drafts stay private and outside story saves just like direction drafts.

**Acceptance:** start a situation, visit a character studio, develop/save a reference, cancel and repeat the handoff, reload, then create once with a lost response. The setup survives and only one story exists.

## 4. High — apply the reading-point/action-head distinction to every room

**Guide:** sections 4.1, 5.3, 8, 9 and 10.

The Desk specifies old-position behavior, but Codex correction/retirement/reference adoption and Chronicle organization can still be initiated while inspecting history or another path. Revision checks prevent a stale mutation; they do not tell users where a successful mutation will apply. A mode change or branch-selection command can also invalidate a previously prepared action target.

**Add to section 4.1:**

> Every state-changing action names its actual destination in ordinary language: story, path, and current moment. A read-only inspector additionally labels the moment whose facts are being shown. Editing a historical or other-path record offers either a deliberate change at the selected path’s current head, after showing its current effective value, or Explore from this moment. It never silently edits the past or another unseen action branch. A past passage may be the attachment target for art or wording, while the new placement/display revision is recorded at the chosen path head; show both roles.

> Branch activation completes before a generation plan is created and returns the refreshed action target. Drafts are not silently retargeted by activation, a new result or a configuration change. On conflict, preserve original, current and proposed values; explain the relevant change; offer an explicit refreshed submission or an alternative path. The revised submission receives a new command key. Do not instruct the user simply to refresh and retype.

> Read-only navigation and typing an unsubmitted draft remain available while work runs. New drafting is not another story mutation. A draft composed against the former head requires an explicit target refresh before it can be submitted after completion.

**Desk refinement:** do not make the user scroll to a different passage merely to authorize an otherwise understood target. An explicit continuation-target summary can offer review/jump and continuation from the latest moment; an unqualified Continue while showing history remains prohibited.

**Acceptance:** inspect a past fact on a sibling path while another action runs. Attempt correction, adoption and a later continuation. Every command reaches only the explicitly reviewed destination; a stale rejection preserves all entered work. No late result moves the reading cursor.

## 5. High — preserve current complete tasks during staged restoration

**Guide:** sections 18–20.

The guide preserves capabilities in principle, but B1 replaces navigation while full Gallery and Gate arrive much later. “Keep unfinished rooms out of normal navigation” could accidentally remove working export, saves, image dialogs or studios for several batches. B7’s B4–B6 dependency can also make useful book work wait for unrelated speech work.

**Add to section 18 and revise the batch table:**

> Every batch must preserve a reachable complete route for each currently supported task. Before retiring the original reader toolbar, route or dialog entry, provide its replacement or a visible adapter to the existing working flow. Initial Gallery and Gate may contain the current complete image/export/save tasks with the new navigation; later batches add collection and preparation depth. Do not ship empty rooms, inert promised actions, or hide an existing capability because its redesigned room is unfinished. B1 acceptance includes local export, playable save, upload and access to current studios as well as Follow/Steer.

> Gate’s local book preview/build depends on its publication snapshot, editorial and image contracts, not on audiobook completion. Sharing, listening and old-series conversion cannot block complete private export. Add their capability-specific entry points only when their own workflows are complete.

**Acceptance:** run a preserved-capability task list at each batch, not only at B8. Include tablet interaction checks with the first real shell and each new long task; B8 repeats whole-product qualification rather than discovering keyboard failures for the first time.

## 6. Medium — remembered consent has invalidation rules but no user reset contract

**Guide:** sections 7, 8 and 13.

Typed consent and configuration hashes are good. The guide does not yet specify where a user can inspect, revoke or choose remembered consent, what it means during an already authorized run, or how action quantities remain visible after modal bypass. Exact audio segment counts also vary per action; a changing exact count should not create an accidental barrage of configuration dialogs.

**Evidence:** `frontend/app/core/dialogs.js:248` currently bypasses review after remembered consent; current provider/settings UI has no consent-reset workflow. This is a missing task, not evidence of an undisclosed charge.

**Add to section 13:**

> The first review makes Remember this operation configuration on this device an explicit visible preference. Settings provides per-family and all-family Forget remembered approval actions and explains their device scope. Forgetting affects future actions; it does not cancel a run already authorized, delete its accounting or promise a refund. Cancellation of undispatched work remains a separate supported control. Legacy unscoped approval is never upgraded into typed approvals.

> Even when a modal is bypassed, the paid action area displays operation type, current role/model, target, actual planned quantity and maximum calls or segments, estimate status and a Review details action. Local actions remain plainly labelled and available without providers. Cache hits say no synthesis; unchanged structured rulings say no new AI call.

> Separate a remembered configuration ceiling from exact action quantity. A quantity inside an explicitly remembered ceiling need not repeat the modal, but remains visible. Increasing the ceiling or exposure requires fresh review. Bounded Auto-read and audiobook runs always identify their exact frozen scope; starting a new run never silently extends a previous authorization. A changed plan during review returns to the originating task with the reason and no dispatch.

**Acceptance:** approve one text configuration, attempt reference development and painting, change model/exposure/ceiling, reset one family, cancel a review and return after reload. Check the exact operations that need review, zero dispatch on cancel, retained draft, and unchanged active-run accounting.

## 7. Medium — candidate acceptance needs the submitted seed, not only saved/current/candidate

**Guide:** section 11.

Tracking current fields, candidate and saved baseline is insufficient if fields change after a development purchase starts. The candidate was produced from a particular submitted seed, which may already differ from the saved baseline. A later response must not overwrite those intervening edits or be compared against the wrong baseline.

**Evidence:** current `frontend/app/fiction/library.js:144` captures a seed, then `:156` populates returned fields. The guide correctly replaces unconditional population; the comparison contract needs one more explicit identity.

**Add to section 11:**

> Freeze the submitted seed revision and development plan alongside the candidate. Compare each candidate field with that submitted seed and the current edited field, while retaining the saved baseline for ordinary save comparison. Mark fields changed since submission and leave their candidate acceptance unchecked until reviewed. Accept selected fields is a local reversible draft edit; Save persists the explicitly reviewed current draft. Restore previous fields identifies the draft revision it restores and preserves later edits through comparison, rather than replacing them silently. A response received after leaving the studio becomes a recoverable candidate and status notice, never an automatic field update or reopened sheet.

**Acceptance:** edit a motive while development is delayed, leave the studio, return and selectively accept other fields. The new motive survives and the candidate’s exact seed remains inspectable.

## 8. Medium — define the copyedit contract at every consumer before D1 is enabled

**Guide:** sections 4.2–4.3, 10, 12, 15–17; D1 and B4.

The D1 decision gate is sound, but “wording revision” does not yet say whether future generation uses original or effective wording. Audio and books explicitly use effective wording. Either generation choice has consequences. The guide should state them instead of leaving each consumer to decide. A meaning-preserving requirement cannot be proven through a text-length or schema check.

**Add under D1 and to B4:**

> If D1 is accepted, copyediting changes effective reader/book/audio wording on the selected path. Future narrative context uses applicable effective wording, with authoritative original events, knowledge and corrections still taking precedence. The edit surface states: Wording changes do not recalculate recorded events or knowledge. Use Correct a fact or Explore an alternative for a change of meaning. This is an explicit user responsibility and repair path, not a claim that automatic validation detects every substantive edit.

> Before save, show original/effective/proposed wording, the path and passage being changed, and directly recorded evidence affected. Keep original evidence with an Original wording label when it differs from displayed prose. Saving is local and never starts extraction or semantic review. Conflicts preserve the proposed wording. Reverting creates another applicable display revision rather than deleting provenance. Frozen books/audio keep their earlier wording until an explicit new edition is requested; cached content hashes must differ.

**Acceptance:** alter a name, alter event meaning, undo through a new revision, fork before/after the edit, and export/synthesize from two editions. Confirm the declared consumer behavior and no silent canon recalculation or paid repair. Stakeholder acceptance of D1 remains necessary before enabling the feature, not before finishing this guide.

## 9. Medium — a pause is different from ending an episode

**Guide:** sections 8 and 12.4.

“Closure kinds such as pause” risks making ordinary stopping end an episode, forcing a new title/question on return. The guide otherwise says stopping is valid and no wizard is compulsory.

**Evidence:** `backend/src/modules/fiction/store.js:187` marks End as ended; `:236` prevents further narrative purchases until another episode begins. This is a real behavioral distinction.

**Replace the closure paragraph in section 12.4 with:**

> Leaving or Pause saves position and acknowledged drafts without changing episode status or requiring a recap, rating or closure choice. On return the same episode can continue. End this episode is a distinct local action with an optional summary and optional closure kind such as open ending or vignette; default values permit one-step completion. It never invents goal resolution. Show what carries forward. Offer an immediate local undo when the target is unchanged; after later episode activity, use an explicit alternative path instead of rewriting history. Starting another episode may use a supplied default title with an optional question.

**Acceptance:** stop mid-conversation, return and continue the same episode; end intentionally with unresolved goals; undo an accidental ending; begin another episode without required planning fields. All stopping/closure actions are provider-free.

## 10. Medium — turn the refusal/correction invariant into an executable recovery path

**Guide:** sections 8, 10, 12.4, 13 and 20.

I10 states an essential boundary, but there is no complete user task for a refusal, a repeated structured attempt, or prose disagreeing with its saved ruling. A generic error or “try again” can lead users back into paid persuasion loops.

**Add to section 8:**

> A recorded structured refusal shows its public explanation, relevant public evidence, and whether an unchanged approach is a free recorded outcome. New grounds can support a new attempt; rephrasing alone is never advertised as a fresh chance. Offer read evidence, draft a different approach, change future play style, correct an erroneous fact, or explore an alternative as distinct actions. Correcting a fact or changing style does not pretend an in-world success was earned or reverse a recorded ruling automatically. Owner correction reasons remain private and correction never causes a fictional penalty or mechanically creates episode payoff.

> When prose appears inconsistent with a ruling, retain the passage and record, identify the discrepancy without claiming automatic semantic certainty, and offer local correction or a preserved alternative. Any regenerated prose is a new reviewed purchase. Plain fictional refusal, provider refusal, validation rejection and unavailable provider configuration have different explanations and next actions.

**Acceptance:** use one unchanged guard approach with the provider unavailable, one genuinely changed basis, an intentional owner correction and conflicting mocked prose/effects. Repeated outcome stays free; no private justification leaks; the owner can repair independently of a character’s cooperation.

## 11. Medium — owner planning needs an exit and share-screen-safe transition

**Guide:** sections 5.1, 7.3, 10 and 11.

Explicit owner planning and server-side projection are correct. The task contract should also cover a returned private draft/candidate, Back navigation, copied summaries and switching from planning into ordinary story reading. Otherwise a UI can technically close a private panel while leaving private search text or candidate previews in a public-facing context.

**Add to section 5.1:**

> Owner planning is visibly marked throughout the task. Entering it explains that it reveals setup secrets; it is not required to read, follow or make a public correction. Leaving clears private inspection nodes, private transient previews and selection state from reader surfaces while keeping private server drafts recoverable through planning. Back/Forward restores a private task only through the explicit planning route after authentication; it does not inject private fields into a reader query/cache. Public return summaries and task breadcrumbs contain no private values. Private here means hidden from reader projections; the paid review separately states which fields go to a provider.

**Acceptance:** enter planning, open private draft/candidate/evidence, switch room/path, use Back/Forward, lock and unlock. Assert no private strings in reader DOM, reader API payloads, recaps or book previews; distinguish that mechanical result from a guarantee against prose spoilers.

## 12. Medium — sharpen acceptance evidence and avoid new setup burden

**Guide:** sections 12.1–12.3 and 20.

The performance-baseline discipline is good. Several journey outcomes remain adjectives such as “clear” or “work,” while the model-capacity safety rule could become an unnecessary advanced setup barrier if implemented literally. Both need acceptance at the user-task level.

**Add to sections 12 and 20:**

> Keep perspective, tense, language, length, scene details and context limits out of required story creation. Use defaults and trustworthy provider capability/catalogue data where available. Only an actual missing prerequisite blocks its paid action; reading, setup, corrections, organization and export remain available. For unknown model capacity, present a specific advanced configuration repair and return to the preserved task, rather than requesting technical context settings during every first story. The effective settings summary distinguishes a hard application boundary, an explicit user preference and a model-followed target.

> Device evidence records actual portrait/landscape sizes, keyboard behavior, enlarged text and input method. Success means submit/cancel and room navigation remain reachable, focused fields are not covered, layout does not require precision gestures, and the displayed paragraph anchor returns within the agreed viewport tolerance. Measure acknowledgement and load targets on the baseline device before fixing numeric budgets. If layout changes, a paragraph anchor may be a correct restoration even when the pixel offset differs.

> In a small formative task study, ask participants to explain the target and paid/local consequence before pressing; locate correction, a past passage, art and export without facilitator directions; and recover a mocked failure while retaining their work. Record completion, wrong-target actions, unexpected purchase expectations, help requests and repair burden. Set exploratory targets before the study and report the sample and observed failures. Small-sample success is not statistical proof of universal usability. Do not optimize token use, purchase count or time played as engagement goals.

## Sound decisions to preserve

- One authoritative fiction graph, separate view/action state, immutable exact forks and revision checks.
- Reader-director as a complete experience; optional ownership and rich craft without compulsory setup.
- Stable named rooms with a quiet Desk, complete task sheets and one shared focus/scroll/dirty lifecycle.
- Public filtering before limits; explicit planning; distinctions between reader, provider, books and private saves.
- Local corrections independent of fictional permission; no automatic memory purchase or semantic-proof claim.
- Action-specific plans, typed configuration consent, durable call accounting and no automatic provider retry.
- Context budgeting that protects ownership and relevant fixed truth instead of silently dropping constraints.
- Frozen media/publication editions, accurate partial spend, and separation of stopping playback from cancelling undispatched synthesis.
- D1 and old-series conversion explicitly gated; neither makes the core recovery or this documentation wait.
- Source, CI, visual review, actual tablet tasks and narrative evaluation recorded as different kinds of evidence.

## Decisions and limits

The only stakeholder-policy decision in this review that must precede enabling its feature is the guide’s existing D1 wording-edit exception. Old-series conversion and release naming retain their existing separate gates. Default draft expiry, paragraph-anchor tolerance, comparison layout and reset placement are ordinary implementation/design choices to test, not new reasons to ask broad permission questions.

The reading-position, draft, dispatch and episode findings above are supported by code behavior and the draft’s stated contracts. Their likely impact on perceived control, discoverability and confidence is a design hypothesis requiring stakeholder walkthrough and real-device task evidence. No new user study or rendered-device review was conducted. The stakeholder’s ChatGPT permission-prompt crash is not an observed Ink Morrow defect.

Review complete. Work is not continuing until the coordinator supplies the refined-guide cross-discipline pass.

## Final consistency pass — refined draft 0.2

Read the complete refined guide and roundtable disposition, including the cross-discipline source/edition choices. **No remaining planning-blocking contradiction was found.** The guide now distinguishes inspected and action heads in every room, protects exact submitted draft/action identities, treats absent lookup records as uncertainty, defines acknowledged versus unsaved recovery, preserves work before story creation, and keeps current complete tasks available through the shell transition. Consent reset, candidate comparison, planning exit and pause/ending behavior now have usable task contracts.

The chosen D1 policy is internally explicit: effective wording supplies recent-prose presentation while immutable facts, original evidence and corrections remain authoritative. It neither promises meaning-preserving validation nor silently grants a rewritten outcome. The existing D1 implementation gate and semantic evaluation requirement are sufficient; this pass adds no new stakeholder decision.

Planning acceptance remains conditional on the implementation evidence already required in the guide, especially:

- A delayed original command racing absent lookup/recovery produces one dispatch/result; the submitted revision never clears a newer draft.
- Immediate Lock, offline input, late authenticated saves and reload preserve exactly the acknowledged recovery guarantee while clearing private client content.
- Browsing, correction/adoption, branch activation and attachment use their declared targets; reading remains possible during work and late results never move the cursor or reopen tasks.
- Remembered consent/reset, playback pause/cancellation and partial known/unknown charges remain truthful through later-stage dispatch and credential loss.
- The real Android tablet completes keyboard-open, enlarged-text, task-close/Back, evidence-return and save/recovery journeys; screenshots and desktop emulation alone do not establish this.

These are conditional implementation/device gates, not observed test successes or reasons to delay the completed documentation. No new source edits, runtime tests, user tests, servers or paid calls were performed. Final review complete; work is not continuing.
