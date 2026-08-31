# Final 4.0.0 round table

Status: **concerns resolved and accepted by the stakeholder**

## System architect

**Position:** Proceed with a clean 4.0 kernel, but preserve the proven modular
backend, page-provenanced ledger, prepared-page transaction safeguards, and
portable-archive validation patterns from 3.2.2.

**Primary concern:** A globally reusable world that remains live inside every
story would let a catalogue edit retroactively change canon. The same problem
already solved for character casting must also be solved for worlds.

**Resolution:** Library entities are templates. A story owns immutable
story-local snapshots and later accepts template changes only through an
explicit reviewed import. Accepted.

**Primary concern:** Public sharing would pierce the current single-owner
security boundary.

**Resolution:** Sharing is an isolated, capability-token route over immutable
published snapshots. It cannot expose private story APIs, mutate data, or
invoke providers. Accepted.

## Security expert

**Position:** The current single-owner seal is a strong baseline for local use,
but uploads, public snapshots, UI-managed provider credentials, and richer
archives create new trust boundaries that require their own controls.

**Primary concern:** “Any image” must mean any image subject, not arbitrary
active bytes served back as trusted content.

**Resolution:** User uploads receive no semantic moderation. The server still
streams to bounded staging, verifies signatures and decoded dimensions,
randomizes storage names, strips metadata by default, and never serves active
SVG. SVG input is rasterized before storage or rejected when safe
rasterization is unavailable. Accepted.

**Primary concern:** Provider credentials and manuscripts are plaintext on
disk; public deployment is easy to misconfigure.

**Resolution:** Keep self-hosting explicit, preserve loopback-by-default,
separate secrets from exportable data, never log secrets or prose, document
the at-rest boundary, and gate snapshot sharing behind TLS guidance and
deliberate publication. Accepted.

## UX/UI expert

**Position:** Start the 4.0 information architecture and visual system fresh.
Preserve underlying capabilities, not the current screens.

**Primary concern:** A feature-rich setup wizard would repel an experienced
author before they reach the manuscript.

**Resolution:** Library → Begin manuscript or Import → one-sheet start → Desk.
Offer blank opening, story seed, and imported prose. Create Volume I and
Chapter I automatically. Keep deeper Foundations optional and contextual.
Accepted.

**Primary concern:** Brand voice on every label can make basic actions obscure.

**Resolution:** Use a two-layer voice: literal verb or noun for the control,
branded supporting text around it. The manuscript surface is typographically
calm; atmosphere intensifies at thresholds and transitions. Accepted.

**Veto criterion:** Any backend shortcut that requires users to understand
internal state, creates repeated confirmation noise, hides the exact text being
committed, or makes portrait-tablet use confusing must be redesigned before
merge.

## Developer

**Position:** Deliver by vertical, reversible pull requests against a release
integration branch. Establish data invariants before building the new shell.

**Primary concern:** A single rewrite PR would be unreviewable and would erase
working 3.2.2 safeguards.

**Resolution:** Nineteen dependency-ordered implementation PRs, each with
schema/API contract, tests, rollback boundary, and explicit non-goals.
Accepted.

**Primary concern:** Supporting many export formats independently would create
format drift.

**Resolution:** First build one normalized publication document, then thin
format adapters. Golden fixtures compare semantic structure across every
format. Accepted.

## Stakeholder amendments

The stakeholder chose to keep the current Grok image sanitation behavior
because it works well for most stories. The original proposal to remove
automatic sanitation was withdrawn.

To preserve artistic freedom, 4.0.0 adds a first-class **Upload an image** path.
User-selected images receive no content classification or provider call and
may depict anything the user lawfully chooses, including external generations,
original art, or personal photographs. Only technical security validation
applies.

## Final disposition

All four disciplines recommend proceeding. The accepted risk posture is:

- maximize authorial control while preserving truthful provider boundaries;
- make destructive canon changes deliberate and recoverable;
- keep art noncanonical and semantically unrestricted;
- expose no public mutable application surface;
- keep provider costs and data disclosure direct and comprehensible;
- favor coherent architecture over compatibility with the alpha data model;
  and
- block beta on data loss, canon corruption, credential exposure, duplicate
  spend, invalid publication output, or a broken critical authoring flow.
