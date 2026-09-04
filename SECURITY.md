# InkMorrow 5.0 security

InkMorrow is a private, single-owner application, not a public multi-user service.
This document describes the 5.0 code line. Historical 4.x threat models remain
archived; they are not instructions for the new runtime. Report the exact version
and deployment shape when raising a security issue.

## Access boundary

First-run requires a random terminal setup code and a distinctive 15–128-character
NFC-normalized password. Passwords use asynchronous scrypt with random salts
(`N=2^15, r=8, p=3`). Only a SHA-256 digest of each opaque session token is stored.

Cookies are HttpOnly and SameSite=Strict, with Secure under trusted HTTPS.
Remembered sessions expire after seven idle days or thirty total days;
unremembered sessions after eight idle hours or twenty-four total hours.
Lock revokes one session; password change revokes the others. Setup/login have
progressive delays and a temporary ten-attempt/fifteen-minute limit.

Private APIs are authenticated before parsing bodies. Mutations require the
session CSRF token and same origin. Host checks limit DNS rebinding; restrictive
browser headers and private no-store responses protect the HTTP boundary.
Ordinary JSON is capped at 256 KiB; uploads and binary saves have independent limits.

The production executable explicitly requires authentication even with
NODE_ENV=test. Retired authoring, public-share and manual-opening APIs are not
mounted. The user manual remains public for setup and recovery guidance.

## Credentials and model work

Provider credentials come from environment, process memory or an AES-256-GCM
vault. APIs never return keys. Password change rewraps the vault key; remembered
login after restart does not itself unlock stored credentials. Re-enter the
password when needed.

Storyteller and optional quality reviewers can receive relevant hidden facts,
motives, directions and bounded prose. Standard, Memory and Both quality choices
have explicit role/model plans, at most one repair and four/six total-call ceilings.
Off permits one call. Prior single-call consent does not authorise quality work.

Models and reviewers are untrusted advisers. Structured effects, ownership,
evidence and challenge outcomes are validated before atomic commit, but generated
prose can still be inconsistent or reveal a spoiler. Resistance is game behaviour,
not an access-control or perfect semantic-security guarantee.

Each actual call is journalled before dispatch. No uncertain transport failure is
automatically retried. Known charges and unknown attempts survive rejection and
interruption. Credentials never enter story context, saves or ordinary API output.

## Images, books, saves and old data

Uploads are authenticated before parsing, limited to 20 MB and 40 megapixels,
container-checked and decoded fail-closed. Metadata/animation are stripped and
orientation normalized into WebP. Active SVG and forged/polyglot files are refused.
Upload itself sends nothing to a model and performs no semantic moderation.

AI painting sends only the selected passage and art direction to the reviewed
Illustrator. It sends no private facts, motives or uploaded references, and makes
one attempt. Books contain only current-path prose and placed illustrations.
Review the prose before sharing: filtering private fields cannot undo a model's
secret disclosure already written into it.

Private `.inkmorrow5` saves are bounded gzip-JSON with all paths and private state,
not old manuscript ZIP archives. They are unencrypted. Import validates fields,
ancestry, evidence and media before a transactional new copy. Credentials,
provider configuration, consent and pending request authority are excluded.

5.0 defaults to `database-v5/ink-morrow-5.db`. Existing database/journal files are
inspected through a private scratch copy before normal startup. Older families,
future versions, bad ledgers and orphan journals are refused without adoption.
This is not a live backup service: stop other writers before operator copies.

## Recovery

Stop the exact installation and verify DATA_DIR/DB_PATH. From backend:

```bash
npm run auth:reset -- --yes
```

This removes the owner, sessions and saved provider credentials from the selected
5.0 database. Stories and media remain. It refuses missing, in-memory or old-family
databases. Relative paths resolve from backend/, matching startup. Keep a cold
backup before recovery; the next start prints a new setup code.

## Network and limits

Loopback (`HOST=127.0.0.1`) is the safe default. For remote access, prefer an HTTPS
reverse proxy on loopback, explicit ALLOWED_HOSTS and TRUST_PROXY=1. Trust applies
only to the loopback proxy. Verify Secure cookies and Host rejection.

Direct non-loopback HTTP requires ALLOW_INSECURE_LAN=1 and is unencrypted.
Never expose that configuration directly to the public internet. This project
does not claim a hardened public hosting service.

The web password is not whole-disk encryption. Database, media, saves and backups
can be read by someone with filesystem access; .env may contain a provider key.
Protect the operating-system account and use encrypted devices/backups as needed.
A compromised OS, administrator, browser extension, proxy or provider is outside
this boundary. There is no MFA, email recovery or shared-account role system.

OpenAI-compatible endpoints may differ in catalogue, text and image behaviour.
Review the actual provider's privacy/retention policies independently.
Fixture tests do not certify live model quality. Desktop/mobile Chrome coverage
does not imply every browser engine or physical device has been tested.

## Reporting and further detail

CI audits production dependencies and pins third-party actions. Keep supported
runtime/dependency versions and inspect security updates rather than bypassing
a failing audit.

Use the [private advisory form](https://github.com/rthorman/ink-morrow/security/advisories/new),
not a public issue, for exploitable findings. Include a minimal reproduction,
version, deployment and impact; omit real prose, passwords, cookies and keys.

Read the [complete Security handbook](docs/pdf/Ink-Morrow-5.0-Security-Privacy-and-AI-Boundary.pdf),
[Operations handbook](docs/pdf/Ink-Morrow-5.0-Operations-and-Recovery-Handbook.pdf),
[Privacy notice](PRIVACY.md) and [Legal notices](LEGAL.md).
