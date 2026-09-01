# Accepted product decisions

Status: **accepted**
Applies to: **ScribeTribe 4.0.0**

## Product constitution

ScribeTribe is a tool for co-authoring long-form narrative fiction with AI,
from short books through long novels and larger works. Story quality is the
first measure of success. The application must preserve meaningful events,
character and world consequences, believable development, and coherent
character arcs across the life of a manuscript.

The user is the dominant co-author. The AI proposes; the user decides. This is
not a chatbot and must not frame the author as a passenger in an autonomous
story. Every AI feature must have a clear, story-serving purpose.

The 4.0 release line is free and open-source software under
`AGPL-3.0-only`. It begins at an independent Git-history root so no earlier
MIT-licensed project commit is an ancestor. The historical `main` line through
3.2.2 remains MIT-licensed and unchanged. ScribeTribe is self-hosted, has no
organizational backing, does not sell a service, does not process payments,
and does not become a party to the user's relationship with an AI provider.

## Intended author

The primary author is an avid reader moving into authorship with AI. They are
experienced with computers and web applications, intellectually demanding,
and willing to learn useful power features. They will tolerate depth but not
arbitrary friction, unclear state, data loss, or an interface that wastes
their attention.

The project serves all genders equally and adopts no ideological or moral
litmus test for stories. ScribeTribe itself does not classify or suppress
lawful narrative content on moral grounds. Provider policies and applicable
law remain external constraints, and the interface must represent provider
refusals honestly.

## Canon and narrative time

1. A story has exactly one canonical timeline. There are no branches.
2. Only the current tail page is substantively editable.
3. The next page has not happened yet. A prepared next page is speculative,
   noncanonical, and contributes no continuity state.
4. Advancing promotes the exact prepared prose, freezes the former tail, and
   starts exactly one successor preparation.
5. To substantively change an older page, the author must truncate every page
   after it, making that page the true active tail.
6. Truncation offers an immediate undo and a recoverable deleted-suffix record.
   Recovery is not a second canonical branch.
7. Historical copyediting is allowed. It changes displayed and exported prose
   but does not recalculate established state. Future generation may read the
   edited prose. A quiet, contextual notice explains that large edits can make
   prose and recorded canon diverge; responsibility remains with the author.
8. Authoritative continuity corrections are allowed through an impact-aware
   workflow. The interface shows source evidence, current authoritative state,
   and known downstream inconsistencies. It never silently rewrites existing
   prose.

## Manuscript structure

The canonical hierarchy is:

**Story → Volume → Chapter → Page**

Scenes are not data entities in 4.0.0. Authors may place scene-break markers in
prose. A new story receives Volume I and Chapter I automatically, so structure
does not become setup work.

Reusable worlds and characters live in the global Library. Adding them to a
story creates story-local snapshots. Later Library edits do not silently
rewrite a manuscript's canon. The author may explicitly review and import
selected template changes.

## Page-generation contract

The direction field and primary action form one explicit state machine:

| Condition | Primary action | Result |
|---|---|---|
| Direction empty, prepared page ready | **Next Page** in green | Promote that exact page; never generate a replacement |
| Direction contains text | **Generate as directed** | Preserve the preview until press, then discard it and generate exactly once from the direction |
| Direction cleared before press | **Next Page** in green | Restore use of the same prepared page |
| Directed generation fails | Retry with direction | Keep active page and direction; save no partial page |
| Directed generation fails, then direction is cleared | **Prepare next page** until ready | Start an ordinary fresh preview; do not revive a discarded one |

Every paid operation is idempotent at the application boundary. Stale replies,
double presses, refreshes, and competing tabs must not duplicate a canonical
page or silently spend twice.

## Continuity and AI roles

The logical AI roles are:

- **Scribe** — creative narrative prose;
- **Archivist** — structured continuity extraction and state assistance; and
- **Narrator** — text-to-speech.

One physical model may fill Scribe and Archivist in simple mode. Advanced
configuration may assign separate models because prose quality and strict
state extraction are different tasks. The product language must not call the
prose model the Narrator, because Narrator already means speech.

Continuity is page-provenanced and inspectable. Derived state can be rebuilt
without rewriting prose. Character and world sheets are reference intent, not
proof that an event occurred. Prepared prose contributes no state.

## Art

Art is noncanonical. Narrative may inform art; art never changes continuity or
future prose merely by existing.

The author can place an image between any pages, including historical pages,
without changing narrative page numbering or canon. Art may also remain in the
Gallery without placement.

The Gallery offers two equal paths:

- **Paint with AI** retains the existing Grok sanitation workflow. A provider
  refusal is explained, the sanitized prompt is shown, and the application
  waits for another deliberate press. There is no silent repaint.
- **Upload an image** accepts any user-chosen image content without semantic
  moderation, rewriting, classification, or AI call. Technical file checks
  still prevent executable or malformed uploads from becoming an attack.

An uploaded original is never deleted or modified because a provider later
refuses to use it as a reference. No uploaded image is sent to a provider
unless the author explicitly chooses that action.

## Sharing and exports

Private, revocable, read-only sharing is in beta scope. A share publishes an
immutable snapshot containing manuscript prose and owner-selected art only.
It excludes continuity internals, directions, speculative pages, deleted
suffixes, credentials, costs, and private working history. Viewing a share
never triggers AI.

Public discovery, social feeds, comments, co-editing, and live collaborative
canon are outside 4.0.0.

The complete project export is a versioned **.scribetribe** archive. Publication
exports are DOCX, ODT, RTF, EPUB 3.3, PDF, HTML, Markdown, plain text, and a
documented JSON representation. Publication exports omit private working
state. Export adapters share one normalized publication model so formats do
not disagree about volumes, chapters, page order, art, or metadata.

## Deployment and support

- Self-hosted only for 4.0.0.
- Clean break from 3.x. There is no in-place database migration or 3.x archive
  import. The application detects legacy data and refuses to reinterpret it.
- Chrome Stable is the officially supported browser.
- Desktop and Android tablet portrait/landscape are critical profiles. Other
  devices are best effort.
- Portrait tablets are a primary design target, not a compressed desktop.
- The project has no test department; automated tests and explicit manual
  release scripts must carry the quality burden.

## Brand

The brand statement is:

> Darkly gothic, fantastical, sensually provocative, centered around a
> mythical Scriptorium inhabited by a tribe of mysterious adult catgirl
> scribes who live for the Story.

Branding is prominent on thresholds, transitions, empty states, and the
Library. It becomes quieter around the manuscript. Story legibility,
understandability, accessibility, and task completion take precedence over
ornament.

Every UI text may carry the brand, but not at the expense of comprehension.
Primary controls use plain verbs first; atmospheric language can support them
in headings, descriptions, and status copy.

## Explicit non-goals

4.0.0 does not add:

- hosted accounts or maintainer-operated infrastructure;
- payment, subscriptions, credits, or provider-key resale;
- multiple canonical branches;
- scene entities;
- moral content scoring or application-level fictional-content policing;
- live multi-user editing;
- a public story-discovery network;
- automatic rewriting of historical prose after a continuity correction; or
- guarantees for browsers other than current Chrome Stable.
