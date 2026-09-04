<p align="center">
  <img src="frontend/brand/ink-morrow-lockup.svg" alt="Ink Morrow — Where stories grow claws" width="520">
</p>

<p align="center"><strong>Playable fiction. Follow the cast. Steer what unfolds.</strong><br>Step into a character only if you want to.</p>

<p align="center">
  <img alt="Edition: 5.0.0" src="https://img.shields.io/badge/edition-5.0.0-6e1834">
  <img alt="License: AGPL version 3 only" src="https://img.shields.io/badge/license-AGPL--3.0--only-c7a35b">
  <img alt="Node.js 22.5 or newer" src="https://img.shields.io/badge/node-%E2%89%A522.5-447a63">
</p>

InkMorrow is a self-hosted story game. You normally remain outside the cast,
following their lives and choosing what deserves attention. Continue, steer a
moment, explore another path, or explicitly inhabit someone for a conversation.
There is no manual prose editor and no compulsory avatar.

Choose **Story-shaping** for stronger influence over the direction, or
**Living-world** for credible resistance grounded in people and circumstances.
Both allow quiet cooperation, meaningful relationships and a satisfying place
to stop. Nothing advances while you are away, except a request you already
authorised finishing.

## What 5.0 includes

- Two curated openings, or your own situation and cast; starting is local and free.
- Follow, moment/ongoing Steer, outside-story Ask and optional character control.
- Durable facts, knowledge, commitments and qualitative relationships, with
  evidence, correction, older recall and exact alternate-path history.
- Structured challenges that reuse unchanged rulings without another AI purchase.
  Repeated pleading is not new authority; genuinely sufficient grounds can matter.
- Player-ended episodes, questions, recorded payoff, aftermath and local return recaps.
- Living-world fourth-wall permission: Never, Rarely or Freely.
- Optional consistency review by the standard model, memory-support model or both.
  Off is the default. One reviewer permits at most four total calls; Both permits
  six, with at most one repair and complete known/unknown accounting.
- Local image upload or explicit Illustrator painting. Images appear above reader
  prose and on separate preceding pages in EPUB.
- Visual Library catalogues for worlds, characters and Scribes, with upload and
  AI painting. Setup makes frozen story copies; later catalogue edits do not
  change them. Story covers and cast/reference portraits support both image paths.
- Tablet-friendly passage pagination; Previous, Next and Latest never buy prose.
- Nine reader-safe book formats and private, all-path `.inkmorrow5` saves.
- One-owner authentication, logical provider roles and optional encrypted
  credential storage.

Models remain fallible. Structured state guards do not prove every sentence is
consistent, spoiler-safe or in character. Extra reviewers are a bounded second
opinion, not a guarantee. See the guide's model-choice and trial chapters.

## Quick start

Use Node.js 22.5 or newer with `node:sqlite`, a supported image runtime, and a
fresh 5.0 data location. From the repository:

```bash
bash setup.sh
npm start
```

Review `backend/.env` before starting. The built-in OpenRouter profile reads its
key there; Settings also supports explicit OpenAI-compatible profiles and
session-only or encrypted-vault credentials. The app does not provide credits.

Open `http://localhost:3000` on the same machine. Use the one-time code printed
by the server to set a distinctive owner password of at least 15 characters.
Keep the default loopback bind unless you deliberately configure secure remote
access. See [Operations](docs/pdf/Ink-Morrow-5.0-Operations-and-Recovery-Handbook.pdf)
and [Security](SECURITY.md).

Choose an opening and read it without a model call. Configure a storyteller in
Settings when ready for new narration. Memory support and Illustrator are
separate optional roles. Model-catalogue browsing contacts the chosen provider;
local reading, correction, upload, export and save/import do not buy generation.

> AI calls can cost money even when output is rejected or a connection fails.
> Estimates are not spending caps, and unknown cost is not zero. Set an upstream
> spending limit where supported. Quality reviews disclose their larger call plan
> separately; there are no automatic transport retries or speculative successors.

## Fresh data, not a 4.x upgrade

The default database is `database-v5/ink-morrow-5.db`, family `ink-morrow-5`.
An existing 4.x database is refused without adoption or rewriting its database
or journal files. Keep old installations and important data separate.

`DATA_DIR` chooses the media/data root; `DB_PATH` can override the exact database
file. Relative paths resolve from `backend/` in both startup and terminal password
recovery. Without DATA_DIR, media follows an explicit DB_PATH's directory.

Old `.inkmorrow` manuscript archives and character-template catalogues are not
imported. New `.inkmorrow5` saves preserve every playable path but exclude
credentials, provider configuration, consent and resumable purchases.
They are unencrypted and can contain spoilers and private directions.
Frozen catalogue selections and story images travel in playable saves. The reusable
catalogues themselves need a full installation backup; old-series template import
is still not provided. Existing 5.0 schema-21 stores migrate to schema 22 normally.

Books contain the chosen reading path, not the private playable world. Keep
operator-level cold backups as well: stop the process and copy the complete
configured database/media locations, retaining any database sidecars.

## Documentation library

All six manuals describe the 5.0 game and use the same canonical logo as this
README and the running app.

| Manual | Purpose |
|---|---|
| [User Guide](docs/pdf/Ink-Morrow-5.0-User-Guide.pdf) | Complete play, model choices and end-to-end journeys |
| [Operations & Recovery](docs/pdf/Ink-Morrow-5.0-Operations-and-Recovery-Handbook.pdf) | Installation, storage, backups, access and incidents |
| [System Architecture](docs/pdf/Ink-Morrow-5.0-System-Architecture.pdf) | Current modules, graph, authority and design limits |
| [State Machine Atlas](docs/pdf/Ink-Morrow-5.0-State-Machine-Atlas.pdf) | Transitions, concurrency, failure and invariants |
| [Security, Privacy & AI Boundary](docs/pdf/Ink-Morrow-5.0-Security-Privacy-and-AI-Boundary.pdf) | Access, provider exposure, untrusted output and files |
| [Maintainer, Testing & Release](docs/pdf/Ink-Morrow-5.0-Maintainer-Testing-and-Release-Handbook.pdf) | Tests, documentation QA and exact-head green merges |

The [source and rendering workflow](docs/pdf-library/README.md), [5.0 release
record](docs/releases/5.0.0/README.md), [known limits](docs/releases/5.0.0/KNOWN-ISSUES.md)
and [media/save format notes](docs/fiction-media-saves.md) provide more detail.
Older documents about Desk, Chronicle, Codex, Gallery, Gate or manuscript
archives are historical contracts, not current operating instructions.

## Development and verification

Development is consolidated under WSL. Windows tools may use the same checkout;
do not keep a second independent Windows tree.

```bash
bash setup.sh --dev
npm test
npm run check:brand
npm run check:release
npm run test:e2e
npm run docs:pdf
npm run check:docs:strict
```

Setup preserves existing dependency trees unless `--clean` is explicitly chosen.
Tests use isolated data; browser tests use port 3100, never the owner's port 3000.
Do not download a browser solely for local verification when an existing
browser-capable environment or CI is available.

Feature PRs target `release/5.0.0` and merge only after all five checks pass on
the exact head. Final main integration follows complete implementation and
green CI. A merge is not deployment or permission to start a server.
See [Contributing](CONTRIBUTING.md).

## Credits, license and privacy

The 5.0 game retains the project's established artwork, fonts and security
infrastructure. The 4.0 clean-break implementation, visual assets and manuals
were produced through ChatGPT/Codex under human-led planning and acceptance;
the earlier line has different credits. See [CREDITS.md](CREDITS.md).

Project-owned 5.0 material is [AGPL-3.0-only](LICENSE). Versions through 3.2.2
remain MIT-licensed in historical commits; third-party materials retain their
own notices. See [LICENSE-NOTICE.md](LICENSE-NOTICE.md), [Privacy](PRIVACY.md)
and [Legal notices](LEGAL.md). Report vulnerabilities through the
[private advisory form](https://github.com/rthorman/ink-morrow/security/advisories/new).
