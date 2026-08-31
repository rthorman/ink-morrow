# ScribeTribe 4.0.0 beta planning

Status: **accepted implementation contract**
Decision date: **2026-08-31**
Target: **4.0.0-beta.1**
Integration branch: **release/4.0.0**

This directory is the durable handoff from the alpha-to-beta workshop. It
defines what ScribeTribe 4.0.0 is intended to become and the ordered pull
requests used to build it.

ScribeTribe 3.2.2 remains the shipped behavior until an implementation pull
request changes it. Statements in this directory are target requirements, not
claims about the current application.

Implementation progress is recorded in [PR-QUEUE.yaml](PR-QUEUE.yaml). The
first implementation item is the clean 4.0 kernel; later feature capability is
reported by the authenticated runtime endpoint rather than inferred from the
release-train name.

## Authority and change control

The project stakeholder has accepted these documents as the 4.0.0 baseline.
An implementation pull request may refine internal mechanics, but it must not
change a product invariant or accepted user workflow without:

1. identifying the affected decision;
2. describing the user, security, data, and delivery trade-offs;
3. recording explicit stakeholder approval; and
4. updating this directory in the same pull request.

When documents conflict, use this order:

1. **WORKSHOP-DECISIONS.md** for product intent and non-negotiable behavior;
2. **SYSTEM-ARCHITECTURE.md** and **SECURITY-THREAT-MODEL.md** for data and
   trust-boundary invariants;
3. **UX-ARCHITECTURE.md** for interaction and language;
4. **IMPLEMENTATION-PLAN.md** and **PR-QUEUE.yaml** for delivery sequencing.

## Document map

| Document | Purpose |
|---|---|
| [WORKSHOP-DECISIONS.md](WORKSHOP-DECISIONS.md) | Accepted product constitution and behavior |
| [ROUND-TABLE.md](ROUND-TABLE.md) | Final architect, security, UX, and developer review |
| [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Detailed, ordered pull-request contracts |
| [PR-QUEUE.yaml](PR-QUEUE.yaml) | Machine-readable execution queue |
| [SYSTEM-ARCHITECTURE.md](SYSTEM-ARCHITECTURE.md) | Target data model, module seams, and invariants |
| [SECURITY-THREAT-MODEL.md](SECURITY-THREAT-MODEL.md) | Self-hosted threat model and beta controls |
| [UX-ARCHITECTURE.md](UX-ARCHITECTURE.md) | Information architecture, flows, copy, and responsive rules |
| [ART-DIRECTION.md](ART-DIRECTION.md) | Approved visual direction and reference artwork |
| [QA-RELEASE-GATES.md](QA-RELEASE-GATES.md) | Supported browser, test matrix, and release blockers |
| [../../../LEGAL.md](../../../LEGAL.md) | License-adjacent legal and liability notices |
| [../../../PRIVACY.md](../../../PRIVACY.md) | Current self-hosted privacy disclosure |

## Delivery model

- PR 00, this documentation package, merges to **main**.
- Create **release/4.0.0** from main after PR 00 merges.
- PRs 01–18 target **release/4.0.0** in dependency order.
- PR 19 is the auditable release merge from **release/4.0.0** to **main**.
- A feature is not complete merely because its happy path works. Its tests,
  exposure review, accessibility states, rollback behavior, and documentation
  are part of the same PR.

## Beta definition

Beta means a capable computer user outside the development team can install
ScribeTribe, begin or import a manuscript, author it without corrupting canon,
recover from ordinary mistakes and interruptions, understand provider cost and
data exposure, export publication-quality output, and deliberately share a
read-only snapshot without maintainer assistance.

Beta does not mean a hosted service, public discovery, multi-user
collaboration, payment processing, perfect cross-browser support, or a promise
that an AI provider will accept every request.
