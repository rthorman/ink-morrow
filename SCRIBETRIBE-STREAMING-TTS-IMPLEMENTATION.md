# ScribeTribe streaming page narration — OpenCode implementation contract

Use this file as a normative implementation instruction for **OpenCode running GLM-5.3** inside the existing ScribeTribe repository.

The objective is to add a **Read aloud** control to the reading surface. It must begin playing the current rendered page while speech is still being generated, allow the user to pause or stop it, obtain the available OpenRouter speech models and voices dynamically, persist the selected model and voice in the existing Settings system, and account for every billable generation through the application's existing AI-cost ledger.

This is an integration task, not permission to rewrite the application.

## 1. Instruction precedence

1. Preserve authentication, authorization, user content, persistence, current reading behavior and existing AI-cost accounting.
2. Follow this implementation contract.
3. Follow the repository's existing `AGENTS.md`, OpenCode instructions, ScribeTribe branding specification and established engineering conventions.
4. Prefer existing services, components, schemas, queues and test facilities over new parallel abstractions.
5. If repository evidence conflicts with an assumption in this document, preserve working behavior and adapt the implementation without weakening the acceptance criteria.

## 2. Required working method

Begin in **Plan mode**. Do not edit files until repository reconnaissance is complete.

Inspect and report:

- the framework, package manager and relevant build/test commands;
- the route and component that render the current reading page;
- how the application defines a page and obtains its authoritative readable text;
- the existing Settings route, persistence mechanism and validation pattern;
- the existing OpenRouter client, API-key ownership and server-side request path;
- the existing AI usage/cost schema, write service, aggregation code and cost UI;
- the existing audio/player facilities, if any;
- server/proxy behavior that could buffer streamed responses;
- applicable authentication, authorization, rate limiting and background-job facilities;
- existing browser, integration and visual test infrastructure.

Then provide:

1. a concise repo map;
2. exact files expected to change;
3. any required schema migration;
4. the proposed streaming transport for the current stack;
5. how TTS cost events will enter the existing AI-cost ledger;
6. a staged implementation and verification plan.

Ask a question only when code inspection cannot resolve a material product decision. Once the plan is approved, implement the complete feature rather than stopping at scaffolding, mock controls or an unconnected API route.

## 3. Non-negotiable behavior

- The reading surface has a clearly labelled **Read aloud** control.
- Activating it reads only the current logical page, in correct semantic order.
- Playback starts before the complete page audio has been generated or downloaded.
- The OpenRouter credential never reaches browser code, client logs or rendered markup.
- Settings contains a TTS model selector and a dependent voice selector.
- Model and voice choices persist using the existing Settings mechanism and scope.
- The server validates the selected model and voice; it never trusts arbitrary client values.
- Every accepted OpenRouter TTS generation is reconciled into the same AI-cost ledger used by the rest of the product.
- Cost accounting is idempotent and uses OpenRouter's authoritative generation cost when available.
- Replaying already-buffered audio during the same reading session must not create a duplicate cost event.
- Changing page, leaving the reader, pressing Stop or starting a new narration cancels obsolete work and clears the obsolete playback queue.
- The feature is fully usable on desktop and portrait tablet without hover.
- Existing reading, writing, saving and AI features continue to work when TTS is unavailable.

## 4. OpenRouter contracts

Use the existing server-side OpenRouter integration and configuration. Do not add another API key or a second unrelated HTTP client unless the existing client cannot stream binary responses.

### Speech creation

Call:

```text
POST https://openrouter.ai/api/v1/audio/speech
```

with a server-side request shaped like:

```json
{
  "model": "<validated model id>",
  "voice": "<validated voice id>",
  "input": "<normalized current-page text>",
  "response_format": "pcm"
}
```

The endpoint returns binary audio, not JSON. It supports `pcm` and `mp3`. Prefer `pcm` when the existing browser/audio stack can consume streamed 16-bit little-endian PCM correctly. Otherwise use `mp3` and prove that progressive playback starts before the upstream response completes. Do not claim streaming merely because a `ReadableStream` type appears in code.

Do not add `stream: true`; the dedicated speech endpoint itself returns a raw audio byte stream.

Capture these upstream response headers before forwarding the body:

- `Content-Type` for correct playback handling;
- `X-Generation-Id` for cost attribution and debugging.

Forward audio bytes as they arrive. Respect backpressure. Do not call `arrayBuffer()`, `blob()`, `readAllBytes()`, `io.ReadAll`, or an equivalent full-body buffering method on the production streaming path.

### Speech-model discovery

Obtain the current catalogue server-side rather than hard-coding a permanent model list:

```text
GET https://openrouter.ai/api/v1/models?output_modalities=speech
```

If the repository already maintains an OpenRouter management key and filtered model discovery, prefer:

```text
GET https://openrouter.ai/api/v1/models/user?output_modalities=speech
```

Do not introduce or expose a management key solely for this feature.

From the response, retain only valid speech-output models that the application can present safely. Use the exact OpenRouter `id` as the submitted value and a human-readable `name` as the label. Obtain voices from `supported_voices`.

- Do not invent voice IDs.
- Exclude models with no usable published voice list unless the existing integration has an explicit, tested provider-default or custom-voice workflow.
- Humanize voice labels for display, but submit and persist the exact voice ID.
- Cache the catalogue server-side for a short bounded interval using existing cache facilities.
- Preserve a saved selection only while both its model and voice remain valid.
- If a saved model disappears, mark narration unconfigured and direct the user to Settings; never silently charge a different model.
- A provider rejection still remains possible after discovery. Handle it as a recoverable error rather than silently falling back to another priced voice.

## 5. Settings requirements

Extend the existing Settings page and persistence model. Do not create a second settings screen.

Add a section labelled **Narration** containing:

1. **Model** — searchable/selectable when consistent with existing controls;
2. **Voice** — disabled until a model is chosen and populated only with voices supported by that model;
3. a short disclosure that reading aloud sends the current page text to the selected provider through OpenRouter.

Required behavior:

- Loading Settings obtains the cached speech catalogue through the application's backend.
- Selecting a different model clears an incompatible saved voice immediately.
- When the selected model has voices, select nothing until the user chooses one unless the project's existing settings pattern defines an explicit default.
- Save model and voice atomically using existing validation, mutation and notification patterns.
- Reject a save when the model or voice is stale, unavailable or mismatched.
- Persist at the same user/workspace scope used by comparable AI preferences. Do not guess a global scope if settings are per user.
- Existing installations receive a safe migration state: narration is unconfigured until a valid model and voice are selected, unless the product already has a documented default-selection mechanism.
- The read control explains how to configure narration when no valid selection exists; it must not fail silently.

Do not hard-code prices into Settings. If the existing Settings UI already shows model pricing, render current API metadata using its declared units. Never label token-, character- and UTF-8-byte pricing as interchangeable.

## 6. Reading-page control and player state

Place the control with the current page's reading actions, respecting the existing ScribeTribe component and icon system. It must be real text plus an icon where appropriate, not an unexplained speaker glyph.

Implement an explicit state machine equivalent to:

```text
unconfigured -> idle -> starting -> playing -> paused -> completed
                              \-> failed
starting/playing/paused -> stopping -> idle
```

UI behavior:

- `idle`: **Read aloud**
- `starting`: visible progress state and an available Cancel/Stop action
- `playing`: **Pause** plus **Stop**
- `paused`: **Resume** plus **Stop**
- `completed`: return to **Read aloud** or **Read again**, matching existing wording conventions
- `failed`: concise error plus Retry when safe
- `unconfigured`: control remains discoverable and links or navigates to Narration settings

The state is announced accessibly without repeatedly interrupting screen-reader users. The button remains keyboard operable, has visible focus and provides a minimum 44 × 44 px touch target.

Do not auto-advance to the next page. This feature reads the page the user explicitly requested. Page navigation, document changes and route departure stop the current stream. If later product requirements add continuous reading, implement that separately.

## 7. Authoritative page text

Use the same content source that renders the current page. Do not scrape the complete document, navigation chrome or arbitrary `document.body.innerText`.

The narration input must:

- contain only text the authenticated user is authorized to read;
- preserve paragraph and dialogue order;
- exclude buttons, menus, page numbers, hidden text, accessibility-only control labels and decorative captions;
- decode entities and normalize whitespace without flattening meaningful paragraph boundaries;
- avoid sending raw HTML or executable markup;
- be bounded by a server-side size limit;
- never be written into ordinary application logs, error telemetry or AI-cost descriptions.

Prefer sending an authenticated page/document identifier to the backend and resolving authoritative text there. If this application's page exists only as a client-side computed projection, send normalized page text with the relevant document/page identifiers, then enforce authorization and a strict size limit server-side. Document why the chosen route is safe for the actual repository.

## 8. Streaming and chunking

One ordinary e-book page may fit safely in one speech request. Preserve the page as the billing and interaction unit, but segment unusually long pages at paragraph or sentence boundaries when required for reliable startup and provider limits.

For multi-segment pages:

- use stable, deterministic segmentation;
- never split inside a Unicode grapheme, word or sentence unless a provider hard limit makes it unavoidable;
- keep model, voice and relevant provider options constant across all segments;
- begin playback from the first segment while preparing the next;
- prefetch at most the small number of segments required for gapless playback;
- preserve ordering even if requests finish out of order;
- stop scheduling new segments after cancellation;
- do not pre-generate the next page.

Choose the simplest streaming implementation supported by the current stack:

- a backend pass-through stream for a single page/request; or
- a small ordered segment protocol when several upstream requests are necessary.

Do not add WebSockets if ordinary streamed HTTP and the existing player are sufficient. If a reverse proxy, framework adapter or deployment platform buffers responses, configure the narrow route appropriately and add a test proving that the first audio bytes reach the client before the final upstream bytes.

## 9. Cost accounting — mandatory

First inspect the existing AI-cost system. Reuse its table/entity, money type, transaction boundaries, service layer, aggregation queries and user/project attribution. Do not create `tts_costs`, a standalone TTS dashboard or a second definition of total AI spend.

Treat one OpenRouter speech request as one underlying AI usage event. A page may therefore create several ledger events only when it required several actual upstream speech requests.

### Authoritative reconciliation flow

1. Before making the upstream request, create or prepare the existing equivalent of a pending AI-usage operation with an internal request ID.
2. Record non-sensitive metadata using the repository's existing field names:
   - feature/category: TTS or `read_page` according to the existing taxonomy;
   - provider: OpenRouter;
   - selected model ID;
   - selected voice ID when the schema permits non-sensitive metadata;
   - user/workspace/project/story attribution already used by AI costs;
   - document/page identifiers where permitted;
   - input character count and UTF-8 byte count;
   - request status and timestamps.
3. Capture `X-Generation-Id` from the TTS response headers and attach it as the external generation ID.
4. Stream audio immediately. Do not wait for cost lookup before playback.
5. After completion, failure after acceptance, or user cancellation with a generation ID, reconcile asynchronously through:

   ```text
   GET https://openrouter.ai/api/v1/generation?id=<X-Generation-Id>
   ```

6. Use `data.total_cost` as the authoritative USD inference cost. Also retain the actual `model`, `provider_name`, `latency`, `generation_time` and other fields only where they map cleanly into the existing cost/audit model.
7. Upsert or finalize the cost row using the generation ID as an idempotency key. Retries, reconnects and repeated reconciliation must never double count.
8. If generation metadata is temporarily unavailable, mark the event `cost_pending` using the closest existing status and retry with bounded backoff through existing job facilities. Do not block playback and do not permanently replace actual cost with a guess.
9. If the request failed before OpenRouter accepted it and no generation ID exists, finalize it as an unbilled failure according to existing conventions.
10. If the user cancels after acceptance, still query the generation ID and record whatever cost OpenRouter reports.

Do not calculate the final ledger amount from a hard-coded per-character price. A provisional estimate may be shown only if the application already supports estimated costs; it must be explicitly marked estimated and replaced by `total_cost` after reconciliation.

Ensure existing aggregate totals, user/project reports, date filters and provider/model breakdowns include TTS automatically. Add the smallest migration or taxonomy extension required by the current schema.

## 10. Session reuse and duplicate-cost prevention

- Pausing and resuming an already-received buffer must not call OpenRouter again.
- Replaying the same page within the active reader session should reuse the in-memory completed audio when safe and reasonably bounded.
- Do not introduce persistent storage of narrated book text or audio unless the repository already has an approved cache with retention and authorization rules.
- If an existing AI-result cache is reused, key it by a content hash plus exact model, voice, response format and normalization/segmentation version. Never use only page number or title.
- A cache hit creates no new AI cost event because no upstream generation occurred.
- A cache miss and regeneration creates a new event even when the source text is identical.

## 11. Security, privacy and abuse controls

- Keep all OpenRouter credentials server-side.
- Apply the reader's normal authentication and document authorization to the narration route.
- Prevent the route from becoming an unrestricted public text-to-speech proxy.
- Enforce request size, per-user concurrency and rate limits using existing facilities.
- Abort upstream work when the downstream client disconnects where the runtime permits it.
- Do not include page text in URLs, ledger descriptions, analytics events or exceptions.
- Sanitize upstream errors before returning them to the browser.
- Do not reveal API keys, provider internals or full upstream response bodies.
- Preserve current CSRF, CORS and content-security practices.
- The disclosure in Settings must accurately state that page text is sent to OpenRouter and the selected provider for narration.

## 12. Error behavior

Handle at least:

- narration not configured;
- model removed after it was saved;
- voice removed or invalid for the selected model;
- empty or non-narratable page;
- authentication/authorization failure;
- insufficient OpenRouter credit (`402`);
- malformed request (`400`) or payload too large (`413`);
- model not found (`404`);
- rate limit (`429`);
- provider/server errors (`500`, `502`, `503`, `524`, `529`);
- network interruption before and during playback;
- page navigation or component unmount during generation;
- browser audio autoplay restrictions;
- unsupported or malformed audio format;
- cost reconciliation temporarily returning no metadata.

Errors must explain a useful recovery action without claiming that no cost occurred. If a generation ID was issued, reconcile cost regardless of the playback outcome.

## 13. Responsive and accessibility requirements

Desktop and portrait tablet are equal-priority. Validate at minimum:

- 1440 × 900 desktop;
- 1280 × 800 compact desktop;
- 1180 × 820 tablet landscape;
- 768 × 1366 tall tablet portrait;
- 800 × 1280 tablet portrait;
- 820 × 1180 tablet portrait;
- 390 × 844 phone stretch-goal sanity check.

Requirements:

- no control depends on hover;
- buttons remain at least 44 × 44 px;
- model and voice selectors work with touch, keyboard and screen reader;
- long model/voice names truncate or wrap without horizontal page overflow;
- playing, paused, loading and failed states are conveyed by text/state as well as color;
- motion respects reduced-motion settings;
- the control does not obscure prose or alter the readable text column;
- audio controls remain reachable in portrait orientation when browser chrome reduces viewport height.

## 14. Tests required

Use the repository's existing test stack. Do not make live, billable OpenRouter calls in ordinary CI.

### Unit tests

- speech-model filtering and catalogue normalization;
- dependent voice-list behavior and stale-selection clearing;
- settings validation and persistence;
- authoritative page-text extraction/normalization;
- size limits and deterministic segmentation;
- player state transitions;
- cancellation and stale-response suppression;
- generation-ID idempotency;
- cost reconciliation from `data.total_cost`;
- pending-cost retry behavior;
- cache/session replay does not add a cost event.

### Integration tests

- a mocked upstream response delays its final bytes; assert that the client receives playable first bytes before upstream completion;
- proxy/backpressure behavior does not buffer the entire page;
- `X-Generation-Id` is captured while audio is streamed;
- a completed stream produces exactly one ledger event per upstream request;
- an aborted stream with a generation ID is reconciled exactly once;
- a pre-acceptance failure produces no fabricated spend;
- TTS costs appear in the existing aggregate AI-cost totals and filters;
- changing the model invalidates an incompatible voice;
- unavailable models and voices produce recoverable UI states;
- authorization prevents narration of another user's page.

### Browser/manual verification

- configure model and voice, reload Settings and confirm persistence;
- begin narration and confirm audible playback starts before the complete response finishes;
- pause, resume and stop;
- navigate away during generation and verify playback/upstream work stops;
- replay buffered page audio without a second cost event;
- verify keyboard, touch and screen-reader behavior;
- verify desktop, tablet portrait and tablet landscape compositions;
- run one explicitly authorized low-cost live smoke test and confirm its OpenRouter generation ID and exact ledger cost.

## 15. Implementation stages

1. **Reconnaissance and approved plan** — no edits.
2. **Settings and model discovery** — server catalogue, validation, persistence and dependent voice UI.
3. **Server speech adapter** — authenticated OpenRouter request, binary streaming and cancellation.
4. **Reader controls** — state machine, playback, current-page extraction and navigation cleanup.
5. **Cost integration** — generation ID capture, asynchronous authoritative reconciliation and existing totals.
6. **Hardening** — rate limits, errors, accessibility and responsive behavior.
7. **Verification** — formatter, linter, typechecker, tests, production build and browser checks.

Run the narrow relevant checks after each stage. Do not postpone all verification until the end.

## 16. Definition of done

Do not report completion unless all statements are true:

- [ ] The current reading page has a functional, labelled Read aloud control.
- [ ] Playback begins before full-page synthesis/download completes.
- [ ] Pause, resume, stop, completion and error states work.
- [ ] Page navigation stops obsolete narration and generation.
- [ ] Model options come from current OpenRouter speech-model discovery.
- [ ] Voice options depend on and are validated against the chosen model.
- [ ] Model and voice persist in the existing Settings system.
- [ ] OpenRouter credentials remain server-side.
- [ ] Current-page text is resolved and authorized safely.
- [ ] `X-Generation-Id` is captured for accepted TTS requests.
- [ ] `data.total_cost` is reconciled into the existing AI-cost ledger.
- [ ] Cost reconciliation is asynchronous, retriable and idempotent.
- [ ] Existing AI totals and breakdowns include TTS spending.
- [ ] Session replay does not create duplicate cost events.
- [ ] No live billable calls run in normal CI.
- [ ] Desktop and portrait-tablet behavior pass the required checks.
- [ ] Existing reading, writing, persistence and AI behavior remain intact.
- [ ] Formatter, linter, typechecker, relevant tests and production build pass, or every pre-existing failure is reported precisely.

## 17. Completion report

Report only:

1. files and schema changed;
2. the selected streaming architecture and proof that it does not full-buffer;
3. model/voice discovery and persistence behavior;
4. how generation IDs and authoritative costs enter the existing AI ledger;
5. commands and tests run with results;
6. any remaining limitation, failed check or deliberate compromise.

Do not declare success based solely on a successful build or the appearance of a button.

## 18. Official references

- OpenRouter TTS guide: <https://openrouter.ai/docs/guides/overview/multimodal/tts>
- OpenRouter speech endpoint reference: <https://openrouter.ai/docs/api/api-reference/tts/create-speech>
- OpenRouter speech-model discovery: <https://openrouter.ai/api/v1/models?output_modalities=speech>
- OpenRouter user-filtered model API: <https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails>
- OpenRouter generation metadata and authoritative cost: <https://openrouter.ai/docs/api/api-reference/generations/get-request-%26-usage-metadata-for-a-generation>

