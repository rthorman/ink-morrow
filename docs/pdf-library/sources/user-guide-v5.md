# User Guide

<div class="frontmatter">

> InkMorrow 5.0. Follow the cast, steer what matters, and return to a world whose
> history belongs to the path you played. This guide covers the complete game,
> optional model calls, private saves and practical end-to-end journeys.

</div>

## A story worth following

InkMorrow is playable fiction. You normally remain outside the cast: you follow
their lives, decide what deserves attention, and influence what unfolds. You do
not need an avatar, a character sheet, or a main character representing you.
Reading and inviting the story to continue are valid ways to play.

You can also choose to inhabit a character. That is an explicit, reversible
handoff, not a requirement or an automatic consequence of starting a story.
The same story, history, facts and paths continue whichever way you participate.

The story text is the experience itself. It does not need a later conversion
from a roleplay transcript into something that counts as the real story.

## Installation and the private threshold

The local application serves its interface and API together. The production
entry point requires an owner password, same-origin requests and authenticated
sessions. On first run, use the setup code printed by the server and choose the
owner password. This is a private, single-owner installation, not a multi-user
account service. Keep the server local unless you deliberately configure secure
network access using the Operations and Security handbooks.

Version 5.0 uses a separate data location, `database-v5/ink-morrow-5.db` by
default. It refuses 4.x databases instead of upgrading them. Keep old installations
and their data separate; choosing an old path is an error, not a migration step.
The operator can choose another fresh location using DATA_DIR or DB_PATH.
See the Operations handbook for installation, backup and password recovery.

After unlocking, the story shelf is the starting point. Lock closes the private
interface, clears its private working state and revokes that browser session.
Remembered login does not imply that encrypted provider credentials remain
unlocked after the server restarts.

## Your first ten minutes

Begin with **The Garden After Rain** if you want a quiet first session, or
**The Drowned Bell** for a mystery. Give the story a title, leave character control
alone and keep Optional consistency quality Off. Starting and reading the curated
opening are free. The situation, cast and initial records are already there.

Open Settings and assign a storyteller before requesting new narration. If the
operator supplied a provider credential, you may only need to choose its model.
Otherwise add your provider and credential. The app does not supply credits.
Use a limited-spend provider account and understand what context will leave your
machine before approving a purchase.

Return to the story and press Continue once. The button becomes busy immediately;
wait for the outcome. Read the passage before deciding whether to continue. If
you want to linger, select Steer and write: “Stay with this conversation; give
both people room to answer.” Leave the scope at This moment only.

Open What changed if a development surprises you. Follow an evidence link to its
source. If the record is wrong, make a factual correction; if it is merely an
outcome you dislike, consider a different approach or a new path. Those are
different choices, and neither needs a penalty.

After a few passages, end the episode. Download a playable save if you want a
portable copy. You have completed a real session without inhabiting anyone,
creating an illustration or mastering every panel.

The objective is an interesting experience, not a high turn count. There is no
attendance streak, catch-up debt or requirement to exhaust every feature.

## Start with a situation

Choose **Start a story**. Supply a title and a situation worth exploring. For
example: two old friends meet again, and one has something to confess. A clear
situation gives the narrator something to develop without requiring a world bible.

Choose character drama, mystery, exploration or cozy discovery. Genre guides the
narration; it is not a promise of a specific ruleset or dice system.

Two authored openings are available. **The Drowned Bell** begins a harbour mystery
with a small cast and fixed hidden truths; **The Garden After Rain** offers quiet
cooperation with no hidden catastrophe. Choose the opening, then Begin this story.
Its cast, opening and facts are included without a provider call. Characters you
add are additional people. **Use my own situation** clears the preset.

Open **Cast and story preferences** when you want more control. You can
add a few characters, describe who they are and what they want,
choose pacing, select gentle or dramatic consequences, and state tone or
content boundaries. None of the characters must represent you. Initial casts
support at most 24 members, including the curated cast and selected references.

**Choose from the Visual Library (optional)** selects one world, one Scribe and
any catalogue characters. Details and images are copied into the new story;
later catalogue edits cannot change it. Preview a selected world or Scribe and
check the cast portraits. More loads another local catalogue page without AI.
Curated openings retain their own facts and people: choose compatible references,
or use your own situation. The Scribe is a narrative craft reference, not your avatar.

Starting is a local, free operation. It does not call a provider, paint a cover
or prepare speculative prose. Curated scenarios include an opening to read.
For your own situation, Continue invites the first generated passage explicitly.
There is no manual prose editor or hand-written opening field.

## Choose the experience you want

Play style, participation, consequence tone and quality are separate choices.
You do not have to accept a difficult world merely to avoid playing an avatar,
or buy extra reviews merely to use Living-world.

| Choice | Useful starting point | What it does not imply |
|---|---|---|
| Story-shaping | You want strong influence over the direction | Permission to erase established truth |
| Living-world | You enjoy people and circumstances resisting | Constant hostility, punishment or randomness |
| Reader-director | You want to follow and occasionally steer | Passive failure or lack of agency |
| Inhabit | You want to choose one person's words and actions | Guaranteed success or control of everyone |
| Gentle consequences | You prefer recoverable, lower-pressure developments | Everyone must agree |
| Dramatic consequences | You welcome more consequential tension | A crisis in every scene |
| Quality Off | Speed and lower cost are the priority | Guaranteed flawless prose |
| A quality reviewer | You accept extra checks and possible repair | Independent proof that a passage is correct |

For a welcoming first session, choose Story-shaping, gentle consequences and Off.
For a mystery with credible boundaries, choose Living-world and Never for
fourth-wall addresses. These are starting suggestions, not ranks of serious play.

Change preferences when your mood changes. They apply to future responses on
this path and are recorded in its history. They do not rewrite the opening or
erase a previous refusal. To compare two styles from the same situation, create
an alternative path first, then change the style there.

A satisfying session might end with a small reconciliation, a useful discovery,
or an unresolved question worth returning to. InkMorrow does not define success
as obedience, exhaustive exploration or relentless escalation.

## Follow, steer, or ask

**Continue** invites the narrator to develop the cast and situation. You can read
without typing a direction. The reader shows one passage at a time: **Previous**,
**Next** and **Latest** turn pages without AI calls. Previous loads older moments
when needed; “loaded” means the page count covers only the retrieved history.
Continue always extends the latest moment, even while you read an earlier page.

The direction box lets you intervene as a reader-director: “Stay with their
reunion,” “Show the sister's perspective,” or “Let the awkwardness breathe.”
Choose **Steer the story**, then **Send direction**. Ctrl/Command + Enter sends
the same action while the direction box has focus.

The default is **This moment only**: your direction shapes this response, not
every later scene. Choose **Keep this focus** only for an ongoing instruction.
It becomes visible above the direction box after a successful response. **Clear
ongoing focus** releases it locally, without an AI request. A one-moment detour
does not erase an existing focus. Failed requests keep both your text and scope.

**Possible directions (optional)** offers a few intentions from reader-visible
context. Choosing one fills the box for review; edit or send it when ready.
Nothing has happened merely because you selected it. Existing drafts are not
overwritten, and Continue never requires an invitation.

Choose **Ask outside the story** for clarification. The answer is displayed as
out-of-story discussion, not as an event that happened. It must not change world
state or advance fictional time. Asking still uses the text provider and can cost
money. It is not a back door to undiscovered secrets.

Every paid action immediately shows busy feedback and disables duplicate actions.
A successful response saves readable prose and its validated state changes
together. There is no automatic paid successor or background NPC simulation.

## Choose your storyteller

Open **Settings** to inspect the selected storyteller and provider. The logical
backend role is named Scribe; in this interface it is your storyteller. Choose a
text provider and model identifier, or browse that provider's model catalogue.
Save the assignment explicitly. An unavailable model is not silently replaced.

The built-in OpenRouter profile uses a read-only environment credential. To enter
a key in the interface, add a separate OpenAI-compatible provider profile, choose
it, and save its credential. The endpoint must be HTTPS or supported loopback
HTTP. Keep the key in server-session memory or encrypted in the local vault.
Encrypted storage requires the owner password. Keys never enter stories, browser
storage, ordinary API responses or portable story material.

Model browsing is not a generated story operation, but it contacts the provider's
catalogue. Initial story creation and local corrections do not need model browsing.

The first paid review explains the operation and what is sent. It names the
provider and model and includes a rough cost estimate, not a spending cap. Existing
device consent is remembered; later deliberate paid actions may run without a
new modal. Relevant hidden world truth may be supplied to the narrator even though
it is not shown in the reader's recap. Do not enter material you are unwilling to
send to your chosen provider. If the reviewed provider/model changes before a
new request begins, refresh and review the new configuration.

## Model consistency and fair resistance

Prose fluency, price, speed, continuity and resistance are different model
qualities. Some models become too accommodating when challenged repeatedly.
Do not assume a newer, larger or more expensive storyteller is a better referee.
No models have yet been certified by an InkMorrow live comparison; recommendations
must name the tested model version, settings and date rather than a timeless winner.

Choose **Story-shaping** or **Living-world** when beginning, or change **Play style**
in Story preferences. The first honours desired developments within continuity;
the second allows credible resistance based on motives, knowledge, relationships
and circumstances. Neither requires you to become a character. The selected style
is visible in the reader. Changes apply to future play on this path; they do not
reverse recorded outcomes. Rewind restores the style recorded at that moment.

A royal guard should not grant entry simply because a request is repeated, but
should reconsider genuinely sufficient authority. Structured challenge decisions
are application-owned, and repeating an unchanged decision makes no new provider
request. This protection applies to explicit structured challenges, not a promise
that every free-form character conversation is mechanically reliable. Contradictory
generated sentences remain possible even when state cannot be changed that way.

For stories with structured challenges, **Cast & story → Approaches to this
situation** offers explicit approaches and shows recorded outcomes. The game first
checks locally whether an existing ruling still applies. Unchanged rulings need no
paid review or provider purchase; new attempts use the ordinary paid boundary.
**Read the decision moment** opens its actual record. Controls concerning a person
you inhabit do not supply that person's decisions for you.

## Optional consistency quality

Standard play is the default: one storyteller call for each new passage or Ask.
In **Cast & story → Story preferences**, Optional consistency quality offers
four choices. The choice belongs to this path, restores on rewind, and travels
with a playable save. It is independent of play style and fourth-wall permission.

| Choice | When the first draft passes | Absolute call ceiling |
|---|---|---|
| Off — standard play | One storyteller call | 1 |
| Standard-model review | Draft plus standard-model review | 4 |
| Memory-support review | Draft plus memory-model review | 4 |
| Both model roles | Draft plus both reviews | 6 |

The standard reviewer focuses on motives, relationships, character ownership,
credible cooperation or refusal, boundaries and fourth-wall permission. Memory
support focuses on continuity, established truth, knowledge and commitments.
Both roles receive bounded authoritative context and the candidate passage.
Configure the storyteller and, when used, memory-support model separately in
**Settings**. They may be different models or the same model in two roles.
Using the same model twice is not independent verification.

When a review identifies an evidenced conflict, the storyteller gets at most
one repair attempt. Every selected reviewer then checks the replacement. A
malformed first draft can use that same repair allowance; it does not earn an
extra repair later. If the repair or review fails, nothing is added to the story.
There is no automatic transport retry, paid follow-up or background analysis.

Extra checks add latency and cost, and a rejected passage can still be charged.
Before the first purchase for a configuration, the review names all roles,
providers, models, maximum calls and data sent. It shows a rough estimate, not a
price cap. A prior single-call approval does not authorise quality mode. The
device remembers each approved configuration; changed model/provider settings or
mode require review for the new configuration. Cancelling keeps your direction.

Quality checks are a fallible second opinion, not a guarantee of better writing,
perfect character behaviour or secret-safe prose. A reviewer can miss a problem
or flag a harmless choice. Keep Off when speed and cost matter more; try a bounded
quality choice for a difficult scene if you accept that tradeoff. No paid model
benchmark or model ranking is claimed for this release.

## Waiting, rejection and the real bill

During a quality request, the action stays visibly busy. Progress identifies
drafting, checking or repairing, the active role and its call number. These status
reads are local server reads, not new model calls. Leaving the page does not
cancel work already authorised; returning must never buy a replacement response.

The story totals retain all known charges plus the count of attempts whose cost
the provider did not report. **Recent model calls & costs** shows the latest
twelve calls across the story's paths. A known draft charge is not lost merely
because a later review has unknown cost. Interrupted and rejected work can cost
money without adding a scene. Review details and rejected drafts are not part of
the reader history. Playable saves carry aggregate spend, not request identities
or authority to resume an interrupted purchase.

If a role is unavailable, configure it in Settings and refresh the story before
trying again. The application does not silently drop an enabled reviewer. An
unchanged recorded challenge ruling remains free even with quality mode enabled
and providers unavailable. New evidence can make a new narration appropriate;
repeated pleading alone does not.

## A small, honest model comparison

Models can write beautiful prose and still be poor at consistent resistance.
Test the behaviours important to your game instead of treating price or apparent
confidence as a quality score. A personal trial is useful; it is not certification.

Create two alternatives from the same moment. Keep style, boundaries, context,
control and quality settings comparable. In Settings, explicitly assign the
model before each trial and note the actual provider/model identifier. Changing
a global role affects future purchases, not the identity of already saved prose.

Try a compact set of situations:

- An unchanged plea should not overturn an explicit structured refusal.
- Genuinely sufficient new grounds should allow reconsideration.
- A hidden fact should not become character knowledge without a discovery.
- Affection should not automatically imply trust or cooperation.
- An inhabited person's words and commitments must remain yours.
- A quiet scene should remain interesting without invented danger.
- Fourth-wall permission should respect Never or the Rarely allowance.

Inspect recorded state as well as prose. A well-written sentence may contradict
the game record; a valid record may accompany awkward writing. Record failures,
latency and known/unknown costs separately. Repeat enough to notice variability,
but choose your own spending ceiling before beginning.

First compare with quality Off. If you then test quality, hold the storyteller
constant and compare Off, one selected reviewer, or Both on comparable paths.
Using the same model twice is not an independent judgment, and a second model
may share the first one's weaknesses.

InkMorrow's release tests use deterministic fixtures. They prove bounded calls,
state guards and failure handling, not that any live commercial model wins this
comparison. No model ranking is implied by an example identifier in a test or
configuration file.

## Let characters address the reader

Living-world has a separate **Characters may break the fourth wall** setting.
Choose it when starting a story or in **Cast & story → Story preferences**. It
defaults to **Never**. Changing it is local and makes no provider request.

- **Never:** characters remain within the fiction rather than knowingly speaking
  to you as its reader. Ordinary dialogue between characters is still welcome.
- **Rarely:** the storyteller may include an occasional fitting address. The
  application permits at most one structured address in six narrated passages:
  five ordinary passages must intervene before another. It need not use every
  opportunity. Clarifications, failed attempts and free repeated rulings do not
  advance that cooldown.
- **Freely:** characters may address you whenever it fits. This is permission,
  not a demand for jokes or an aside after every paragraph.

An address appears with the character's name and **to you** in the saved passage.
For example, Jo might look beyond the garden and ask the reader whether the kettle
was optimistic. You can respond through Steer without becoming a cast member.
**Ask outside the story** remains a separate narrator clarification, not a
character's fourth-wall address. The setting is inactive in Story-shaping; its
choice is retained if you switch back to Living-world.

Fourth-wall permission does not relax resistance, grant a challenge, reveal a
hidden solution, or let the narrator speak for a character you inhabit. Asides
cannot supply evidence for a world-state effect. No additional model call is
needed for the address. Its text travels with the passage in books and saves;
rewind and save-copy restore the setting and cooldown on the selected path.

These checks constrain structured addresses. A model can still disobey instructions
in ordinary prose; **Never** is not a proof of semantic model compliance. If it
repeatedly breaks immersion, switch to Never, review the storyteller choice and
use an alternative path as appropriate. With quality Off there is no paid repair. An explicitly enabled quality mode can
attempt its one disclosed repair, but it cannot guarantee semantic compliance.

## Optional character control

Open **Cast & story** and select **Inhabit** beside a cast member. Read the
handoff and choose **Take this role**. The reader now names the controlled
character, and the input selector adds acting and speaking as that character.

Act describes an intention, not a guaranteed outcome. Say supplies your
character's speech. The narrator portrays the surroundings and other people; it
must not invent the controlled character's decisions, speech, thoughts or
commitments. Continue may develop the surrounding situation but should stop at a
decision that belongs to you. Structural state checks reinforce these boundaries,
but generated sentences can still be wrong: retain your editorial judgment.

**Return to reader-director** releases the role explicitly. The narrator again
runs the cast. Your existing story and history are not replaced or converted.

## People can care and still disagree

InkMorrow distinguishes affection, trust, willingness to cooperate and expectations.
These are short descriptions of the relationship, not points to collect. Iona may
care deeply about Mara while distrusting a decision made on her behalf. Jo may
agree to label seedlings without wanting to lead the neighbourhood or becoming
close friends. A willing response is not a promise of unlimited future agreement.

Developments need evidence in the passage or your explicit input. A later scene
can revise a relationship description while retaining its identity and linking to
earlier evidence. It cannot use that mechanism to change a fixed world fact.
When you inhabit someone, their feelings and expectations belong to you; the
narrator must not choose those for you. Other people's views of them may change.
Model prose remains fallible even with structured checks.

Use **Cast & story** and evidence links to inspect what is recorded. **Catch me up**
also gathers current relationships, including older records. If something was
recorded incorrectly, use a factual correction or return to an earlier path.
Disagreeing with a character is not itself evidence that the game needs repair.

## What matters now

A small scene director makes recorded history consequential. A live commitment
can create a later opportunity or acknowledgement; a goal can make a new approach
relevant. Cooldowns discourage immediate repetition. Genre and pacing also leave
space for discovery, relationships, ordinary activity and aftermath. A suggested
scene is a plan, not a fact or a guaranteed outcome. Only the resulting validated
passage can record an event, fulfil a promise or reveal hidden truth.

The **What matters now** panel shows reader-visible durable facts, commitments,
relationships, goals and resources. Hidden truths are not listed. Characters'
knowledge is tracked separately from the truth of a fact.

A generated passage may expose **What changed**. This is an optional explanation
of recorded effects, not a scorecard. Small expressive choices do not need a
permanent statistic. A major commitment should be recorded and remain available
to future narration.

The current working set holds up to 128 facts, with up to twelve effects in one
response. Older facts remain in permanent path history and relevant ones can be
recalled automatically. You do not need to prune memory to keep playing. The
narrator receives bounded recent text and relevant facts rather than the entire
accumulated story on every call.

## Correct a mistake

**Recall older facts** searches this path's public memory, including records no
longer in the current working set. Enter distinctive words and choose **Search
memory**. Results are bounded to 32; refine the words rather than loading the
entire story. Secret and retired records and other paths are excluded. You can
read a record's evidence, correct it, or explicitly retire it here without AI.

**Read recorded evidence** opens the actual source moment. **What changed** links
to the earlier record when a fact changed; an initial fact has no invented scene
citation. Local correction records explain that earlier prose was not rewritten,
and never display private correction reasons.

Choose **Correct a story fact**. Select an existing reader-visible fact or add a
missing one, state what is true, and give a reason. Save the correction.

Corrections affect future narration on this path. They do not silently rewrite
earlier prose, and they have no in-world penalty. The reason is retained privately
in the correction record, not displayed as reader prose. A correction is different
from deciding that you would rather have made another choice.

State validation checks structure and evidence, not every possible semantic
contradiction. A fluent response can still be mistaken. If something important is
wrong, correct it explicitly rather than hoping repetition will repair it.

**Retire a fact** explicitly stops using an entry for future narration on this
path, with a reason. Earlier prose and earlier path snapshots retain it. This is
a correction tool, not required memory maintenance: automatic working-set
compaction already preserves older facts for retrieval. Do not retire commitments
you still want to matter.

## Cast and story preferences

The **Visual Library** contains separate Worlds, Characters and Scribes catalogues.
Choose New entry, give it a name and visible description, fill any useful reference
fields, and Save details. Ordinary saving never paints an image or calls a model.
Worlds have setting and lore; characters have appearance, personality, background
and motive. Keep spoilers out of the visible description. Lore, background and
motives may be private setup that guides the narrator, not facts every person knows.

Scribes retain their adult catgirl identity and offer craft choices such as diction,
rhythm, narrative distance, dialogue, humour and scene tempo. They influence style;
your explicit voice, boundaries and character ownership remain stronger. Choosing a
Scribe does not assign a provider or put her into the story's cast. Settings still
chooses the text model. Bounded frozen references may be sent with narration and
quality checks; the reader and exported book do not expose private reference fields.

On a catalogue card choose **Image: upload or paint**. Upload is local; Paint with
AI uses the Illustrator after paid review. Save description only changes accessible
text. Replacing/removing catalogue art does not change stories already started.
Delete entry removes that reusable entry and its picture, not its frozen story
copies; the image-spend record remains. Refresh catalogue reconciles pending work
without buying another image. Keep a full installation backup for the reusable library.

**Add to the cast** introduces another person locally. Reader-visible description
is separate from their private motive. Generated scenes can also introduce new
named people, up to the 24-person cast bound. Neither route hands you a character.

**Story preferences** changes play style, pacing, consequence tone, content boundaries
and narration voice on this path. The attention field shows a deliberately retained
focus; clear it to release that focus. Preferences are restored with a rewind. Pacing
does not change model randomness, and dramatic consequences do not imply constant
danger. Voice guides style without overriding character control or boundaries.

## Rewind and explore alternatives

**Rewind a choice** creates a new path from an earlier moment while preserving
the original. Choose the moment after which the new path should continue and name
it. Choose the beginning to return to before the opening.

**Explore an alternative** uses the same complete-state branching mechanism,
usually beginning at the current moment. It is for keeping multiple possibilities,
not pretending earlier text is erased. At most 40 paths are supported per story.

The path selector returns to any saved path. Its facts, resources, commitments,
knowledge and control state come with it. A promise made only on one path must
not appear on another. Use **Read earlier moments** if the desired fork point is
older than the currently loaded history window.

These operations are local and free. They are refused while a paid response is
pending, or when another tab has changed the story since the displayed revision.
Refresh rather than repeatedly pressing the same action.

## An episode with room to breathe

An episode can have an organising question. The authored openings supply one;
when beginning another episode you can optionally supply your own. It frames what
is interesting, not a command to achieve a fixed ending. Existing public goals
help the storyteller notice opportunities. You can turn aside or follow a quiet
conversation without losing progress to a timer.

The descriptive stages are Opening, Developing, A recorded payoff and Room for
aftermath. Development follows public changes. Payoff requires a narrated event
that resolves the episode's recorded goals; merely waiting, planning or locally
marking a fact resolved does not fabricate a played resolution. A missing or
retired goal is not silently treated as a victory. Aftermath makes room for what
the changes mean to the people involved.

None of these stages ends the episode. You may stop early, linger after a payoff,
or begin another question when ready. **End this episode** is a local resting
point with an optional short recap, not another paid request. Your cast, facts,
relationships, promises, settings and paths continue into the next episode.

## Two ways to reach a satisfying pause

In **The Drowned Bell**, follow or steer the sisters as they investigate the chart
sale and the bell. Public survey traces provide a fair starting point; the hidden
answer is fixed. Learning who bought the chart does not automatically repair
trust. Allow the sisters to decide a next step together, then linger over what
their new understanding means. Vale's optional survey-record approach can refuse
a plain appeal in Living-world and reconsider when relevant evidence is publicly
established. Repeating the unchanged appeal makes no new AI purchase. You do not
need to inhabit either sister.

In **The Garden After Rain**, explore the working tap, space for a bench and the
neighbours' different wishes. Jo can decline a group role without being hostile.
A genuinely agreed quiet task can create a different basis for cooperation. Let
the layout become welcoming and give each person room to join a first shared
pause on their own terms. Tea and seedlings are sufficient; no surprise catastrophe,
affection meter or compulsory romance is needed to make this a complete episode.

These are possible journeys, not fixed scripts or guaranteed model behaviour.
Story-shaping gives requested developments more influence; Living-world allows
credible refusal. Both support quiet care, alternative paths and stopping without
an avatar. Each new narrated passage is a reviewed AI request. Reading, recaps,
evidence, episode controls and saved-path management are local.

## End an episode and return later

An episode is a useful stopping point, not an obligation to keep generating.
Choose **End this episode**, optionally supply a short recap, and confirm.
The reader offers a resting surface instead of another generation button.

Your story is saved. The world does not move forward while you are away, and
characters do not punish absence from the app. When you want to continue, choose
**Begin another episode** and name it. Cast, history and commitments remain.

Ending remains explicitly reader-controlled. The scene director can invite a
resting point after a resolved thread but cannot end the episode for you.

## Return without catching up on chores

Choose **Catch me up** beside the reader controls. It opens immediately, then
collects the last three narrated summaries, up to six open public commitments
and up to twelve public relationship records from this path. Local corrections
and character-control entries do not push narrated moments out of the recap.
Follow the source links when you need the actual earlier passage.

Time away does not advance the world; a request you already approved may still
finish while you are away. The recap does not call a model, reveal
private motives, draw on another path or generate a new story continuation.
These are bounded reminders, not a second full manuscript: **Recall older facts**
and the reader's earlier moments remain available for a particular detail.

## Illustrate a moment

In Cast & story, choose Illustrate a moment. The dialog opens immediately. Select
a loaded story passage and supply an image description. Read earlier moments first
to illustrate an older passage. Images appear **above** their associated prose.

Upload image accepts a local raster file up to 20 MB and makes no provider request.
The server removes metadata/animation, normalizes orientation and stores a bounded
WebP. Unsupported or unsafe files are refused without changing the story.

Paint with AI uses the separate Illustrator provider/model in Settings. The
selected passage and art direction are sent; hidden facts, motives, other passages
and uploaded image references are not. It buys one image attempt, with no automatic
retry. Cancellation and failure retain your direction. Charges may still occur on
failure. Check the result and use Save description only to correct its accessible
description without buying another image.

Replacing or removing an image changes only the current path. Earlier snapshots
retain the old illustration. Rewind can restore it. There is a 200-illustrated-moment
limit per path and a 400-image limit per story including historical assets.

The same upload/paint choices are available for **Story cover: upload or paint**,
each cast member's **Portrait**, and the selected world and Scribe under Cast & story.
The cover appears on Your stories and above the reader header, and enters the front
of a book. Reference portraits stay in the private story/save, outside the book.
These controls edit the story copy, never its reusable catalogue entry.

Reference painting sends its name, visible description and appearance or setting;
cover painting sends the title and premise. Your art direction also travels. Private
lore, motives and uploaded image bytes do not. Every surface supports upload without
a provider. Image creation alone never establishes a story event or character knowledge.

## Export a reading path or keep a playable save

Choose Export this reading path for a book: EPUB, PDF, HTML, DOCX, ODT, RTF,
Markdown, plain text or JSON. Supply an optional author credit and language tag.
Only current-path prose, its cover and placed illustrations are included—not reference portraits, private facts, motives,
questions, directions or other paths. No AI request is made. EPUB images each have
a separate page immediately before their prose; text remains resizable. Text-only
formats describe illustrations instead of embedding pixels. Missing media makes
export fail visibly rather than silently producing a broken book.

Choose Download a playable save to preserve **all** paths and continue elsewhere.
The `.inkmorrow5` file includes cast, hidden truth, commitments, knowledge, control,
episodes, director history, frozen catalogue references, all story images and aggregate known/unknown spend. It
excludes credentials, provider configuration, payment consent and pending requests.
It is unencrypted: keep it private, and use a book to share with ordinary readers.

On Your stories, choose Import a playable save. Select the file, Check this save,
review its story/path/moment/image counts, then Import as a new story. The original
is never overwritten. No provider call starts. Configure credentials separately
on the destination. Older `.inkmorrow` archives and databases are not accepted.
Portable saves support up to 10,000 moments, 40 paths, 64 MB compressed and 128 MB
expanded, with conservative preflight for unusually large stories. Keep a cold
operator backup as well. A downloaded book cannot restore the playable world.

## Check your save before you need it

A download is only the first half of a useful backup check. Keep both a playable
save for each important story and a cold installation backup maintained by the
operator. They solve different problems.

Before saving, wait for any paid request to reach an outcome and reconcile the
story. Download a playable save to a private folder. It contains hidden world
facts, cast motives and all alternatives, not merely the visible reading path.

On Your stories, choose Import a playable save and Check this save. Read the
reported title and path, moment and image counts. Import as a new story. The
existing story remains unchanged and no provider request begins.

Open the imported copy. Confirm the current passage, a named alternative,
a relationship or commitment, and a placed image if present. Check the play
style, fourth-wall choice and optional quality preference. Imported credentials,
provider assignments and paid consent are intentionally absent: configure and
review future purchases separately.

Download an EPUB or another book format too if you want an independent readable
copy. Open it in a reader and inspect at least one illustrated passage. A book
is easier to share safely, but it cannot reconstruct hidden state or alternate
paths and cannot be imported as a playable save.

Very large stories can exceed the save format's conservative limits. A failed
preflight should not overwrite anything; retain the original installation and
ask the operator for a cold backup. Do not manually edit the save payload or
checksums to force acceptance.

Store copies off the same physical device if recovery from device failure matters.
The application does not upload backups for you, encrypt downloaded files, or
prove that a synchronisation service retained a complete copy.

## Failures, costs and recovery

If a reply fails, your direction stays in the input box and the explanation stays
beside Continue. The app makes a free reconciliation read, never an automatic
paid retry. Invalid output can still cost money. A provider API-key rejection
(401) requires a valid credential in Settings; it is not an InkMorrow login error.

The story header distinguishes known provider spend from attempts whose actual
cost is unknown. Unknown cost is not zero. Returning to a completed request with
the same operation key does not buy another completion; failed requests require
a new deliberate action.

If another tab or action changed the story, refresh before continuing. A late
reply cannot paint a different story you have opened. After a server restart,
abandoned requests are marked interrupted rather than reported successful.
Dispatched work whose response was lost remains an unknown-cost attempt, not a
free one. Each model call allows one transport attempt: even an uncertain network
failure cannot silently trigger another request. Optional quality can buy its
reviewed sequence of calls, but never retries an uncertain transport failure.

Use Download a playable save for a complete game, not older manuscript export
endpoints. Also keep operator-level cold backups of this isolated installation.
Never overwrite older user data.

## Reading on a phone or with a keyboard

The same reader-director experience works on narrow and wide screens.
The header may wrap; the story, path and available actions should remain readable
without horizontal page scrolling. The canonical InkMorrow logo is an image,
not a substitute font that changes between screens.

Use the labelled navigation to return to Your stories or Settings. Within a
story, read earlier moments rather than expecting the browser to download every
past passage at once. Returning to a different story must not show a late answer
from the story you just left.

Dialogs keep the task in one place. Use their labelled controls, Tab and
Shift+Tab to move between fields, and Escape to close when permitted. Closing
an ordinary form is not a paid submission. When a paid operation is already
running, leaving its view does not undo its provider charge.

In the direction box, Ctrl/Command + Enter invokes the same deliberate send
action as the button. Select the input kind and scope first. Do not assume a
keyboard shortcut changes Steer into Say or makes an approach automatically
succeed.

Busy text is meaningful: a disabled button protects against duplicate purchases.
If the interface reports failure, keep the draft and inspect the reconciled
story before choosing another attempt. Repeated taps do not make the model
respond faster.

Use informative illustration descriptions, especially for details that matter
to a reader. Describe the image, not hidden facts absent from it. Correcting
that description is local. In EPUB, the illustration's separate page should
still be followed by selectable, resizable prose.

If a layout or focus problem blocks you, report the action, screen size and
browser, without including keys or private story material. The Maintainer
handbook describes the keyboard, mobile and delayed-response regression checks.

## Journey: no optional provider features

**Goal:** enjoy an existing story and make a portable reading copy without a new
AI purchase. This journey is deliberately not a manual-writing replacement.

1. Unlock the installation and open a story you already have. If none exists,
start a curated opening, or import a trusted 5.0 playable save.
2. Read the available moments. Use Catch me up, What matters now and Recall older
facts when you want context. These are local reads.
3. Compare saved paths. You can create an alternative at an earlier moment, but
without a provider you cannot generate what happens next on it.
4. Correct a genuinely mistaken record or its accessible illustration description.
This changes local future context, not earlier prose.
5. Optionally upload an illustration you already own. Uploading sends the file
to your local server for validation and normalization, not to a model provider.
6. Export the chosen path as EPUB or PDF. Download a playable save separately
if you need every path and the ability to continue later.

**Used:** reading, recap, evidence, paths, local correction, optional local image
upload, book export and playable saves. **Skipped:** Continue, Steer, Ask, AI
painting and all quality reviews. Those new generated responses require providers.

No model selection or catalogue browsing is necessary for these actions.
Catalogue browsing itself contacts a provider even though it does not buy prose,
so leave Settings alone for a fully local session.

The resulting book contains the selected reading path. The save contains private
world state and every path: keep it private. Your owner password does not encrypt
either downloaded file. No background world simulation advances while you read.

If the imported story has quality enabled, local reading is still free. Configure
the required roles only when you later decide to request new narration.

## Journey: a quiet relationship story

**Goal:** a low-pressure evening about people, not a puzzle or an optimisation
exercise. Start The Garden After Rain with gentle consequences. Stay a
reader-director. Choose Story-shaping if you want your intended scene to lead;
choose Living-world if you want differing preferences to shape the conversation.

Follow the first exchange. Steer toward a small shared activity: “Let them work
out where a bench would be useful, without making anyone volunteer for more than
they want.” A character declining a group role need not reject friendship.

Read affection, trust, cooperation and expectations as different descriptions.
You are not trying to fill a relationship meter. If Jo agrees to label seedlings,
that does not establish leadership or permanent agreement. Let later scenes
show whether a small promise was kept and what that means.

Keep quality Off for the simplest, fastest experience. If repeated contradictions
become distracting, first inspect the recorded facts and storyteller settings.
A single standard-model review is an optional experiment, not a compulsory
upgrade. Do not enable both roles simply because more must be better.

Skip Inhabit, structured challenges, AI painting and extensive worldbuilding.
Never for fourth-wall addresses suits an immersive tone; Rarely is available if
a gentle acknowledgment of the reader belongs in this story.

When the group reaches a comfortable pause, linger over tea or the newly useful
space, then end the episode. There need not be a catastrophe, romance or revelation.
A short recap in your own words is a local note, not a prose-writing workflow.

**Used:** curated cast, Follow, Steer, relationships, commitments, episode controls
and a playable save. **Skipped:** avatar control and optional media/model calls.
**Cost:** one storyteller call per new response with quality Off. **Outcome:** a
story worth returning to, with its relationships and unfinished promises intact.

## Journey: a mystery with fair resistance

**Goal:** discover an answer through credible evidence while remaining outside
the cast. Start The Drowned Bell in Living-world, with fourth-wall permission
Never. Keep a clear boundary between what you as reader suspect, what characters
know, and what the world records as true.

Follow the opening and inspect public clues. Steer an investigation rather than
dictating its solution: “Have them compare the survey traces with what Vale
actually remembers.” Ask can clarify the available information, but is not a
secret-answer command.

Use Approaches to this situation for the authored structured challenge.
A refusal should be read as a result with reasons, not an invitation to hammer
the button. Unchanged grounds reuse that ruling without another AI purchase.
Relevant new authority, evidence or circumstances may legitimately change it.
The game should allow earned cooperation as reliably as it allows refusal.

If ordinary generated dialogue contradicts the structured result, recognise the
limit: application-owned adjudication cannot prove every sentence semantically
consistent. Review the evidence, correct a recording error when appropriate, or
branch before the scene. Repeated nagging is not a reliable correction tool.

For a difficult continuity-heavy scene, try Memory review on an alternative path.
It checks the candidate against bounded relevant records and may miss something.
Standard review focuses more on character behaviour; Both adds both checks and
its larger call ceiling. No mode is a substitute for a suitable storyteller.

Skip character inhabitation unless you specifically want to choose one person's
speech. Learning the answer does not force every relationship to resolve with it.
Allow aftermath before deciding the episode is finished.

**Used:** public evidence, knowledge, structured approaches, paths and optional
memory review. **Skipped:** forced avatar play and optional illustration.
**Outcome:** a discovered reading path, plus a private save that still contains
hidden truth and alternatives. Share the book, not the save, with an unspoiled
reader.

## Journey: inhabit one conversation

**Goal:** make one person's decisions while retaining a readable story before
and after that moment. Begin as reader-director and follow until a conversation
matters enough that you want to choose the words yourself.

Create an alternative path before a consequential exchange if you want to
preserve the original possibility. In Cast & story, choose Inhabit for the
person and confirm the handoff. Check the reader's control label before sending
anything: a direction addressed to the storyteller and a character's spoken
line are different kinds of input.

Choose Say for speech, or Act for an intention. An action is not a declaration
that the desired outcome has already happened. In Living-world, another person
may refuse credibly; in Story-shaping, the requested direction has stronger
influence within the established context.

The storyteller owns the surroundings and other people, not your controlled
person's inner decisions. If a response invents their commitment, feeling or
speech, treat that as an error rather than silently surrendering control.
Structured checks help, and optional Standard review may catch additional
problems, but neither is a guarantee about every sentence.

Release the role with Return to reader-director when the conversation is over.
You are not leaving a separate minigame: the same prose, facts, relationships and
history continue. You can end the episode without switching control if you wish;
the saved path preserves the handoff.

**Used:** Follow, optional fork, explicit control, Act/Say, evidence and episode
closure. **Skipped:** unrelated worldbuilding, painting and constant review.
**Cost:** new responses use the reviewed storyteller sequence; taking or releasing
control and creating a path are local. **Outcome:** a continuous reading experience
with one deliberately player-controlled exchange, preserved in a playable save.

## Journey: the complete feature set

**Goal:** explore the full game and finish with both a readable book and a tested
playable copy. Spread this journey over several sessions; features are options,
not a checklist the game expects you to perform every night.

1. Configure storyteller, memory-support and Illustrator roles. Choose session
credentials or the encrypted vault deliberately, and set an upstream spend limit.
2. In Visual Library create a compatible world, an additional character and a
Scribe. Upload reference art or explicitly paint it. Start The Drowned Bell,
select those references, review boundaries, choose Living-world and stay outside the cast.
3. Follow once, steer a single moment, then retain a focus explicitly. Select an
optional possible direction, edit it, and send only when satisfied.
4. Ask a clarification outside the story. Inspect a recorded change and its
evidence. Search older facts; correct only an actual mistake.
5. Try an explicit approach to the situation. Observe a recorded refusal if the
grounds are insufficient. Repeating unchanged grounds is free, not a new roll.
6. Inhabit one person for a conversation, then return to reader-director.
Allow Rarely for fourth-wall addresses if that suits the tone; absence of an
aside is allowed.
7. Create an alternative path. Change style or quality there to explore a
different experience without replacing the first.
8. Select Both quality roles, review its six-call ceiling, and request a passage.
The ordinary passing path uses three calls; one repair can raise that to six.
A failed review can cost money without producing a scene.
9. Upload a story cover and explicitly paint a moment. Inspect world/Scribe and
cast portraits in Cast & story; change a story portrait without changing its template.
Correct descriptions locally. Passage art appears above its prose.
10. Reach a satisfying pause, end the episode, and later begin another question.
Use Catch me up on return rather than buying a recap.
11. Export a reading path as EPUB and inspect its separate illustration pages.
Download a private save, check it, import it as a new story, and verify an
alternate path, cover and portrait. Keep a full installation backup for reusable catalogues.

**Cost boundary:** new narration, Ask, selected quality calls and AI painting are
paid. The remaining actions are local. **Outcome:** one reader-facing book and
one private, verified, all-path continuation copy. Nothing is published publicly
by these actions.

## Coming from the 4 series

Version 5.0 is a new game, not a new layout for the old writing suite.
Your usual position is reader-director outside the cast. Follow and Steer are
complete ways to play; Inhabit is optional.

Manual prose editing, manuscript import,
prepared successor pages, Chronicle/Codex/Gallery/Gate rooms, narration,
audiobooks and public snapshot sharing are not the 5.0 production workflow.
Natural-language direction, starting situations, cast descriptions, factual
correction and short episode recaps remain because they support play.

Reusable visual world, character and Scribe catalogues are available in the new
Visual Library, with upload and AI painting. They are new 5.0 references, not an
import path for old templates. All selected details and images freeze into each story.

The database family is ink-morrow-5. The default location is
database-v5/ink-morrow-5.db, separate from the old database directory. Pointing
5.0 at a 4.x database fails closed; it does not migrate or erase that file.
Keep the old application with its old data if you still need to read it there.

Old .inkmorrow manuscript archives are not accepted. New .inkmorrow5 saves
preserve playable stories and all their paths. Character-template import from
the old series is not provided as a release feature. No conversion is required
or promised before you can enjoy a new story.

Images are now attached to playable moments. They appear above their associated
prose in the reader, and on a separate preceding page in EPUB. A book is a
selected-path reading export; a save is an unencrypted, private continuation
package. Neither includes credentials.

If an older bookmark names Desk, Gallery or a retired API, return to the new
story shelf. Do not try to revive the writing system by changing a URL or
environment setting. The production server exposes the game, while inherited
internal modules remain only for tested implementation reuse.

The short version: start fresh, keep old data separate, and use the new save
format for 5.0 continuity. Historical release records stay in the repository
for reference; they are not current operating instructions.
