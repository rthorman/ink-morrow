# Ink Morrow 4.0.0 security threat model

Status: **accepted beta security contract**
Baseline: **OWASP ASVS 5.0 concepts, proportionate to a single-owner
self-hosted application**

This document is the implemented 4.0.0-beta.1 security contract. The concise
current operator boundary is documented in
[../../../SECURITY.md](../../../SECURITY.md); the historical 3.2.2 code and
license remain preserved in the pre-cutover first-parent history.

## Security posture

Ink Morrow protects one self-hosting owner from casual network access,
cross-site requests, common browser attacks, malformed imports and uploads,
credential disclosure through the application, and accidental publication of
private working data.

It does not protect a manuscript from:

- an administrator or attacker with read access to the running process;
- a compromised operating system, browser, extension, runtime, or reverse
  proxy;
- a provider receiving data the author deliberately sends;
- loss of an unencrypted device or backup unless the owner enables full-device
  encryption; or
- an owner who deliberately publishes or exports private material.

Authentication is access control. The credential vault adds offline protection
for saved provider keys, but the manuscript database and media remain readable
to an account that can read their files.

## Protected assets

| Asset | Primary security property |
|---|---|
| Provider credentials | Confidentiality; never returned, logged, exported, or shared |
| Owner password and sessions | Confidentiality, integrity, revocation |
| Manuscript and continuity | Confidentiality, integrity, availability |
| Speculative pages and directions | Confidentiality and correct noncanonical status |
| Uploaded and generated media | Integrity, safe serving, availability |
| Provider operations and cost records | Idempotency, attribution, honest reporting |
| Portable archives and recovery suffixes | Integrity, explicit exposure, bounded parsing |
| Published snapshots | Immutability, capability confidentiality, revocation |

## Actors

- **Owner:** trusted to administer the instance and decide what to send,
  upload, export, or publish.
- **Share viewer:** untrusted anonymous bearer of a snapshot capability.
- **Remote attacker:** can reach the reverse proxy or persuade the owner to
  open a crafted page, file, link, or archive.
- **AI provider:** receives explicit requests and may return malformed,
  adversarial, policy-refused, or unexpected content.
- **Imported project author:** controls every byte of an archive.
- **Local attacker:** may have filesystem access but not the owner passphrase.
- **Dependency or update attacker:** may attempt to enter through packages,
  Actions, or compromised update channels.

## Trust boundaries

### Browser to private application

The existing fail-closed owner gate remains. Every private API requires an
opaque server-side session. Mutations also require same-origin validation and
the session's CSRF value. Host validation limits DNS rebinding. Authentication
runs before body parsing.

Private responses are no-store. The UI never stores provider keys, manuscript
prose, share secrets, or CSRF values in persistent browser storage.

### Application to provider

Only the backend contacts configured providers. Each cost-bearing review
states, in concise language, the material being sent, selected provider/model,
expected operation count, and estimate.

Provider errors are normalized before reaching the browser. Logs may contain a
correlation ID, status class, provider profile ID, model ID, duration, and
known usage; they must not contain credential values, request prose, image
bytes, full provider bodies, session tokens, or share capabilities.

No uploaded image crosses this boundary unless the owner explicitly selects it
for an AI action. Image upload itself performs no provider call.

### Filesystem and secret vault

Runtime files are created with owner-only permissions where available.
Provider keys entered through the UI use the encrypted vault described in
SYSTEM-ARCHITECTURE.md. Authentication and vault key derivation use separate
salts and purpose labels. Authenticated encryption nonces are unique and stored
with ciphertext.

The unwrapped vault key lives only in server memory while the installation is
unlocked and is zeroed or dereferenced on shutdown, password reset, and the
last applicable unlock expiry where practical in JavaScript.

A remembered application session cannot bypass vault encryption after a server
restart. Manual features may reopen, but the first saved-credential operation
requires the owner passphrase. Terminal password recovery explicitly deletes
saved provider secrets that the old passphrase can no longer unwrap; it does
not delete manuscripts or media.

Environment credentials remain outside the vault and inherit operating-system
process and configuration-file risks. The UI clearly labels that boundary.

### Public snapshot viewer

Snapshot reads are a deliberately tiny unauthenticated surface:

- a capability contains at least 128 bits of cryptographically random entropy;
- the database stores only a keyed hash or cryptographic digest of the token;
- lookup is constant-shape and rate limited;
- the token is never written to logs, analytics, referrers, or page assets;
- the route supports read-only GET/HEAD and no provider action;
- the rendered snapshot contains no private application identifiers or APIs;
- responses set noindex, nofollow, noarchive, a strict referrer policy, CSP,
  MIME-sniffing prevention, and frame denial;
- revocation and expiry fail closed; and
- creating, replacing, or revoking a snapshot requires owner authentication
  and CSRF protection.

A share is publication by capability, not access to the live story. Updating a
story never changes an existing snapshot.

Production sharing requires HTTPS. The application refuses public-share
creation when its configured public origin is insecure, except loopback test
environments. Direct LAN HTTP remains an explicit unsafe escape hatch for
private local use and cannot enable public shares.

## Threats and required controls

| Threat | Required controls | Verification |
|---|---|---|
| Credential disclosure | Encrypted vault; response redaction; no export/log/frontend persistence | Secret-canary tests across logs, APIs, archives, snapshots |
| Cross-site mutation | SameSite cookie, CSRF token, Origin/Referer and Host checks | Integration tests for missing and foreign headers |
| Session theft/fixation | Random opaque token, stored hash, rotation after auth, expiry and revocation | Auth suite and replay tests |
| Password guessing | Memory-hard KDF, long passphrase, bounded progressive throttling | Timing-insensitive integration tests |
| Duplicate provider spend | Idempotency key, one operation owner, context fingerprint, retry join | Concurrent and repeated-request tests |
| Stale provider reply | Expected tail/revision check and superseded state | Race tests with reordered mocks |
| Prompt injection from story text | Structured role separation; schema validation; AI never receives authority to mutate | Adversarial continuity fixtures |
| Malicious archive | Streaming limits, path normalization, declared manifest, hashes, ratio and count limits, transactional staging | Archive corpus and fuzz/property tests |
| Malicious image | Streaming size cap, signature and decode verification, pixel cap, randomized names, raster derivative, metadata stripping | Polyglot, bomb, malformed and metadata fixtures |
| Stored script in prose or metadata | Context-safe DOM rendering, output encoding, no raw HTML from manuscript fields | XSS fixture suite and CSP e2e |
| Active SVG or HTML upload | Never serve original active documents in app origin; rasterize or reject | Content-Type and execution e2e |
| Capability leakage | No logs/referrers/indexing; token hash at rest; revoke/expire | Canary URL tests and header assertions |
| Private-data overpublication | Allowlist snapshot schema and exposure preview | Negative-field contract tests |
| Denial of service | Request, stream, row, pixel, archive and concurrency limits; timeouts | Boundary tests |
| Filesystem escape | Resolve beneath explicit roots; stable opaque names; no user path joins | Traversal and symlink tests |
| Supply-chain compromise | Lockfiles, immutable Action pins, dependency audit and review | CI policy checks |

## Upload policy

“Upload any image” is a content policy, not a parser bypass. Ink Morrow does
not inspect subject matter or classify an image's meaning. It does validate
technical form to protect the owner and application.

Initial accepted formats are JPEG, PNG, WebP, GIF, and AVIF when the runtime's
decoder supports them. Animated inputs are flattened to a safe display
derivative for beta unless animation is explicitly implemented and tested.
SVG is rasterized in a bounded worker or rejected; raw SVG is never served.

Controls:

- stream multipart data to a private staging file;
- enforce both compressed-byte and decoded-pixel limits;
- verify magic bytes and successful decode rather than trusting filename or
  browser MIME;
- reject trailing active/polyglot payloads when the decoder cannot normalize
  them;
- generate storage names from random IDs, never the supplied filename;
- create a normalized display derivative and strip EXIF, XMP, GPS, device, and
  thumbnail metadata by default;
- retain an original only when a future explicit archival option and exposure
  review are implemented;
- serve with fixed Content-Type, attachment for original download, nosniff,
  private caching, and CSP constraints; and
- remove staged files on success, failure, timeout, cancellation, and restart.

These controls follow the engineering principles in the
[OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## AI-output handling

Provider output is untrusted input:

- prose is plain text, never executable markup;
- continuity must validate against a strict versioned schema, with unknown
  fields rejected;
- model-supplied filenames, URLs, HTML, and tool instructions are ignored;
- image media must pass the same decode boundary as uploads;
- provider error bodies are bounded and sanitized; and
- a provider response cannot directly invoke another paid operation.

Grok sanitation is provider interoperability, not application content
moderation. The rewritten prompt is visible and editable, its own cost is
reported, and generation waits for a new owner action.

## Data exposure reviews

Before an operation sends, exports, or publishes data, the owner sees an
action-appropriate summary:

- **provider action:** provider, model, data categories, references, operation
  count, and estimated cost;
- **project archive:** included entities, revisions/history, media, continuity,
  and explicit credential exclusion;
- **publication export:** formats, selected art, metadata, and excluded private
  state; or
- **share snapshot:** included prose/art, immutable behavior, capability
  secrecy, expiry, and revocation.

Repeated reviews should not become nuisance prompts. Remembered consent may
cover equivalent provider actions, but a new provider, data category, image
reference, public publication, or destructive action requires renewed clarity.

## Availability and recovery

- SQLite uses foreign keys, WAL where appropriate, bounded transactions, and
  startup integrity checks.
- Canon mutations write an operation journal.
- Truncated suffixes have a default 30-day recovery window.
- Replace-all import creates a safety archive before mutation.
- Media writes use staging plus atomic rename.
- Boot reconciles incomplete jobs and orphan staging without inventing success.
- Backup documentation includes database, media, vault, and restore testing.

## Beta security gates

Beta is blocked until all are true:

- no known critical or high-severity vulnerability in the supported deployment;
- credentials are absent from API responses, frontend persistence, logs,
  exports, recovery packages, snapshots, and test artifacts;
- UI-entered persistent credentials are encrypted or persistence is disabled;
- malformed/oversized image and archive suites pass;
- public snapshot routes expose only allowlisted immutable data;
- HTTPS and reverse-proxy configuration has a tested, copyable example;
- CSP permits required app behavior without unsafe-inline or unsafe-eval for
  scripts;
- dependency audit has no unreviewed high-severity production finding; and
- the current [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
  and threat model receive a documented final review.

## Disclosure and maintenance

Security reports continue through the repository's private advisory form.
Reports must not include real manuscripts, credentials, sessions, or live share
capabilities. Security documentation must be updated in the same pull request
that changes a trust boundary.
