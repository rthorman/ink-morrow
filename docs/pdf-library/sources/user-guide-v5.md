# InkMorrow 5.0 — User Guide

> Development edition. This guide describes the reader-director interface on the
> 5.0 release branch. The scene-director and complete portable-save batches are
> still in development; their absence is called out rather than hidden.

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

The 5.0 programme is a new-product release. Do not point development builds at an
older installation's database. Use a separate checkout and fresh data. Opening
older databases and story saves is not a 5.0 compatibility commitment. During
development, the package/schema cutover is a later release-hardening batch.

After unlocking, the story shelf is the starting point. Lock closes the private
interface, clears its private working state and revokes that browser session.
Remembered login does not imply that encrypted provider credentials remain
unlocked after the server restarts.

## Start with a situation

Choose **Start a story**. Supply a title and a situation worth exploring. For
example: two old friends meet again, and one has something to confess. A clear
situation gives the narrator something to develop without requiring a world bible.

Choose character drama, mystery, exploration or cozy discovery. Genre guides the
narration; it is not a promise of a specific ruleset or dice system.

Open **Cast, opening and story preferences** when you want more control. You can
add a few characters, describe who they are and what they want, supply an opening
passage, choose pacing, select gentle or dramatic consequences, and state tone or
content boundaries. None of the characters must represent you. Initial casts
support at most 24 members. A current local character template can be copied into
the starting cast; this does not link the story to future template edits.

Starting and saving a supplied opening are local, free operations. They do not
call a provider, paint a cover or prepare speculative prose. An empty opening is
valid: Continue will invite the first generated passage when you explicitly use it.

## Follow, steer, or ask

**Continue** invites the narrator to develop the cast and situation. You can read
several moments without typing a direction. You are not failing to participate by
leaning back and enjoying what happens.

The direction box lets you intervene as a reader-director: “Stay with their
reunion,” “Show the sister's perspective,” or “Let the awkwardness breathe.”
Choose **Steer the story**, then **Send direction**. Ctrl/Command + Enter sends
the same action while the direction box has focus.

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

## What matters now

The **What matters now** panel shows reader-visible durable facts, commitments,
relationships, goals and resources. Hidden truths are not listed. Characters'
knowledge is tracked separately from the truth of a fact.

A generated passage may expose **What changed**. This is an optional explanation
of recorded effects, not a scorecard. Small expressive choices do not need a
permanent statistic. A major commitment should be recorded and remain available
to future narration.

The working state is bounded to 128 facts, with up to twelve effects in one
response. These are safety bounds, not rewards or targets. Do not try to turn
every descriptive detail into bookkeeping. The narrator receives bounded recent
text and relevant facts rather than the entire accumulated story on every call.

## Correct a mistake

Choose **Correct a story fact**. Select an existing reader-visible fact or add a
missing one, state what is true, and give a reason. Save the correction.

Corrections affect future narration on this path. They do not silently rewrite
earlier prose, and they have no in-world penalty. The reason is retained privately
in the correction record, not displayed as reader prose. A correction is different
from deciding that you would rather have made another choice.

State validation checks structure and evidence, not every possible semantic
contradiction. A fluent response can still be mistaken. If something important is
wrong, correct it explicitly rather than hoping repetition will repair it.

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

## End an episode and return later

An episode is a useful stopping point, not an obligation to keep generating.
Choose **End this episode**, optionally supply a short recap, and confirm.
The reader offers a resting surface instead of another generation button.

Your story is saved. The world does not move forward while you are away, and
characters do not punish absence from the app. When you want to continue, choose
**Begin another episode** and name it. Cast, history and commitments remain.

In this development batch, ending is explicitly reader-controlled. Richer
history-driven scene direction and curated openings belong to the next batch.

## Failures, costs and recovery

If a reply fails, your direction remains in the input box. Invalid provider output
can still incur a charge. The interface reports the failure and makes a free read
to reconcile the story; it never automatically buys a replacement response.

The story header distinguishes known provider spend from attempts whose actual
cost is unknown. Unknown cost is not zero. Returning to a completed request with
the same operation key does not buy another completion; failed requests require
a new deliberate action.

If another tab or action changed the story, refresh before continuing. A late
reply cannot paint a different story you have opened. After a server restart,
abandoned requests are marked interrupted rather than reported successful.

Do not use older manuscript export endpoints as a backup of playable-fiction
games. Complete 5.0 portable saves and book-style exports are a later batch. Until
that batch lands, use an operator-level backup of this isolated development
installation after stopping its server. Do not overwrite older user data.

## Example journeys

### A quiet, local beginning

Start a cozy story with a supplied opening and two characters. Read it, record a
missing fact, explore an alternate path and mark an episode's resting point. Skip
Continue, Send, model browsing, art and narration. These local actions use no
provider. The result is persisted in this development installation, not yet a
portable 5.0 save. This is not an AI-free procedural adventure: generated
continuation still requires an explicit provider action.

### Follow a developing relationship

Choose a configured storyteller, start a character drama and supply a small cast.
Continue through the reunion, then steer toward the part that interests you.
Leave character control unused. Consult What changed only when useful, correct
an important mistake and stop at an episode ending. Paid text calls send bounded
story context; local state actions are free. Return to the same path tomorrow.

### Step into one conversation

Begin as reader-director. At a conversation you care about, inhabit one cast
member explicitly, supply their words, and let the narrator portray the response.
Release the role when you want to lean back again. Fork before a commitment if
you want to explore an alternative without losing the original. Skip unrelated
media and authoring tools. You remain in one persistent, readable story.

### Use all current reader features

Configure a provider and optional encrypted credential, supply cast and boundaries,
alternate following with steering, ask an out-of-story question, briefly inhabit
a character, inspect a change, correct a fact, compare paths, and end an episode.
Only the explicitly submitted text-provider actions are paid. The final 5.0 guide
will extend this journey with the director and portable-save features once those
batches are actually implemented and verified.
