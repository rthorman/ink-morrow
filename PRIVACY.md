# Privacy notice for self-hosted InkMorrow

Last updated: **2026-09-04**

Application behaviour covered: **5.0**

> This is a plain-language project notice, not legal advice. An operator remains
> responsible for the privacy requirements of their own deployment.

## The short version

InkMorrow stores playable stories and working data on the operator's machine.
It has no maintainer cloud, analytics, advertising, tracking pixels or crash
telemetry. The maintainer cannot retrieve, restore or erase another installation's
data. Source hosting, package installation and third-party tools have their own
network behaviour and privacy terms.

An explicit AI action sends its disclosed context from the local backend to the
selected provider. Model-catalogue browsing also contacts the provider, without
buying a story response. The provider controls its own retention and processing.
Review its actual policies before sending sensitive material.

## Stored data

The 5.0 installation can contain:

- Cast, situations, readable moments, private motives, hidden world facts,
  knowledge, relationships, commitments, directions and correction reasons.
- Every alternate path and immutable state change, including control,
  preferences, episode framing and illustration placement history.
- Normalized uploaded/generated images and staged files during validation.
- Role assignments, request/call status, models and known/unknown spend.
- Owner password verifier, session digests and authentication timestamps.
- Environment credentials, process-session credentials or encrypted vault entries.
- Browser interface preferences and remembered paid-consent configuration flags.

The session cookie is HttpOnly and SameSite=Strict. CSRF is held in memory.
Provider keys are not stored in browser persistence or included in ordinary
story responses. Rejected drafts and reviewer explanations are not saved as
playable history.

The database, media and downloaded saves are not encrypted as a whole by the
application. Vault encryption protects its stored credential entries, not the
rest of the installation. Protect device access and backups.

## Provider exposure and costs

The storyteller receives bounded relevant context: situation, selected cast,
boundaries, facts (including relevant hidden truth), recent prose and direction.
Optional quality can also send candidate prose and proposed effects to the
standard model, memory-support model or both, potentially at different providers.

Quality is Off by default. Standard or Memory permits at most four total calls;
Both permits six. There is one repair allowance and no automatic transport retry.
The expanded purchase needs its own role/model review. A rejected or interrupted
attempt may still be charged, and unknown cost is not zero.

AI painting sends only the selected passage and art direction to Illustrator,
not hidden facts, private motives, other passages or uploaded image references.
Local upload makes no provider request. Technical validation strips metadata
and animation but does not semantically classify the image.

There is no speculative successor generation, autonomous cast activity,
background continuity extraction, narration or audiobook workflow in the 5.0
production runtime. Local reading, recap, correction, paths, episode controls,
upload, book export and save/import do not buy AI work.

## Reader visibility is not provider confidentiality

Ordinary story APIs exclude private facts, motives and correction reasons,
and evidence is scoped to the current path. Providers may deliberately receive
relevant private world context. A model can reveal it in generated prose despite
instructions or a reviewer's approval.

Do not use fictional secrecy as a place to store real-world confidential data
that must never reach a provider or reader. Structured checks improve control
but do not prove semantic secrecy, resistance or correctness.

## Files, retention and sharing

A book contains the selected reading path and its illustrations, not private
metadata or alternate paths. Read it before sharing: a spoiler already present
in prose remains prose. There is no public snapshot-sharing service in 5.0.

A .inkmorrow5 playable save is an unencrypted all-path continuation package.
It contains private world state and directions, but excludes credentials,
provider settings, consent and pending request authority. Import creates a
new story and never resumes spending. Old .inkmorrow archives are not accepted.

A cold installation backup preserves more, including auth/vault data. Stop the
process before copying complete database/media locations and sidecars; protect
configuration separately. The application does not provide cloud backup.

Retiring a fact or removing an illustration placement does not securely erase
historical records or files needed by other paths. Rewind preserves the old
path. Manage downloaded copies, operator backups and any provider-held data
separately. The maintainer cannot act on data it does not possess.

## Logs and access

Error responses are sanitized and unexpected failures carry correlation references.
Protect terminal/supervisor/proxy logs and do not enable request-body logging.
Never publish provider keys, cookies, private saves, real story data or
unredacted screenshots in issues or CI artifacts.

Loopback is the default. Remote access changes exposure and should use deliberate
HTTPS/proxy configuration. Lock clears private UI state and revokes the session,
but cannot revoke an upstream API key or recall data already sent.

Read [Security](SECURITY.md), [Legal notices](LEGAL.md) and the
[Security handbook](docs/pdf/Ink-Morrow-5.0-Security-Privacy-and-AI-Boundary.pdf).
Report vulnerabilities through the private advisory link in SECURITY.md.
Material changes to storage, telemetry, provider exposure, credentials, uploads
or sharing must update this notice in the same change.
