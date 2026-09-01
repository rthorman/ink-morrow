# Privacy notice for self-hosted ScribeTribe

Last updated: **2026-09-01**
Current shipped behavior covered: **4.0.0-beta.1**

> This is a plain-language project notice, not legal advice. An operator is
> responsible for the privacy notice and lawful basis required by their own
> deployment and users.

## The short version

ScribeTribe is self-hosted software, not a service operated by the project
maintainer. By default, the application stores manuscripts and working data on
the operator's machine and makes no request to a ScribeTribe-owned server.

The project does not provide analytics, advertising, tracking pixels, crash
telemetry, accounts, or a maintainer cloud. The maintainer cannot see, retrieve,
delete, or restore data in someone else's installation.

When the owner deliberately uses an AI feature, the self-hosted backend sends
the necessary request data to the AI endpoint configured by that owner. That
provider processes the data under its own terms and privacy policy.

## Who controls the data

The person or organization running an installation decides why and how its data
is processed, which provider receives it, who can access the installation, and
what is exported or shared. In many data-protection contexts, that operator—not
the open-source maintainer—is the controller responsible for the deployment.

See the European Commission's general explanation of
[data controllers and processors](https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en)
and obtain local advice when required.

## Data stored by the current application

Depending on features used, a 4.0.0-beta.1 installation stores:

- stories, pages, directions, worlds, lore, characters, cast snapshots and
  author settings;
- continuity deltas, corrections, search indexes and provider usage/cost
  records;
- prepared speculative prose and generation metadata;
- generated reference images, covers, scene plates, narration cache and
  audiobooks;
- portable-archive staging and safety backups, immutable publication
  snapshots, and public-share expiry/revocation records;
- a password verifier, hashed session records and authentication timestamps;
- the provider key in the operator-managed backend environment file; and
- interface preferences and remembered paid-action consent in that browser's
  local storage.

The browser session cookie is HttpOnly and SameSite=Strict. The CSRF value is
kept in memory by the frontend. The application does not intentionally persist
provider credentials or manuscript prose in browser local storage.

Data and media files are not encrypted by the application. The owner login does
not protect files from someone who can read the operating-system account or
unencrypted disk. Portable archives are also unencrypted. Use device encryption
and protect backups.

## Data sent to an AI provider

Only an explicit AI or narration action sends data. The exact categories vary
by action and can include:

- story direction, recent prose, folded continuity and relevant older
  memories;
- selected world, character, cast and tone information;
- prompts for drafts, images, covers or continuity extraction;
- selected character/reference images for an image request;
- page text for speech; and
- model, voice, quality and generation settings.

Prepared successor generation and continuity extraction are separate provider
operations associated with the writing flow and may send the contextual data
needed for each. Cost review and settings should be read before enabling them.

The OpenRouter quick-connect path creates one OpenAI-compatible provider
profile. **OpenRouter is the only AI supplier tested with ScribeTribe 4.0.**
The operator may configure another nominally compatible endpoint,
but it may lack model discovery, image generation, narration, reasoning
controls, or may not work at all. Consult each actual provider's privacy,
retention, training, regional-processing, and security terms. The ScribeTribe
maintainer cannot control or erase provider-held data.

Merely opening the app, browsing the Library, reading pages, exporting a manuscript,
or creating a portable archive does not require an AI provider call.

## Network and third-party requests

The frontend and API are served from the same self-hosted origin. Interface
fonts are bundled locally. The current project does not include third-party
browser analytics or advertisements.

The backend contacts the configured AI endpoint for provider features and may
retrieve that endpoint's model/pricing metadata. Normal package installation,
source hosting, operating-system updates, reverse proxies, browsers, and
provider dashboards are separate tools with their own network behavior and
privacy terms.

## Logs

The application is designed to sanitize provider and unexpected errors before
returning them and to use correlation references rather than manuscript text
in diagnostics. Operators should still protect terminal output, process
supervisor logs, reverse-proxy access logs and backups.

Do not enable request-body logging. Do not place provider keys, session cookies,
real manuscripts, private image links, or portable archives in bug reports,
issues, screenshots, or public CI artifacts.

## Exports and deletion

Publication files and portable archives are created on the operator's machine
and downloaded by the operator. Their contents are explained before export.
Credentials, password records, sessions and remembered paid consent are
excluded from portable archives.

Deleting an item may be permanent, subject to the bounded recovery or undo
path offered for that exact operation and backups the operator made. Tail
truncation keeps an expiring recovery suffix; restoration refuses when later
canon makes it unsafe rather than silently merging. Securely delete exported
files, backups, expired recovery material, and provider-held copies separately
when needed.

Because the maintainer has no copy of installation data, data-access,
correction, export, or deletion requests must be handled by the installation
operator and any configured provider. The maintainer cannot act on data they do
not possess.

## Public sharing

Anyone holding a share capability can read that
frozen snapshot until it expires or is revoked. It contains owner-selected
manuscript prose and art only, triggers no AI, and excludes credentials,
directions, continuity internals, speculative/deleted work, costs and sessions.
The self-hosting operator remains responsible for the content, capability link,
TLS, reverse proxy, access logs and recipients.

## Image uploads

Image upload does not semantically inspect or moderate uploaded subject matter
and does not send an upload to an AI provider by default.

For technical safety, the self-hosted application validates and normalizes
the image and strips embedded location/device metadata from its display
derivative by default. The operator and uploader remain responsible for people,
personal information, privacy and rights depicted in an image.

## Security and contact

Read [SECURITY.md](SECURITY.md) for the current access-control boundary and
safe network configuration. Report a vulnerability through the repository's
private security-advisory form linked there. Do not include real personal data
or secrets in the report.

Ordinary repository participation—issues, pull requests, discussions, and
source-host interactions—occurs on the hosting platform and is subject to that
platform's privacy practices, not this self-hosted application notice.

## Changes to this notice

The notice is versioned in the repository. A release that changes telemetry,
provider disclosure, credentials, uploads, sharing, stored categories, or
maintainer-operated services must update it in the same pull request. Release
notes should call out material privacy-boundary changes.

