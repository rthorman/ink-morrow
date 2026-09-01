# Ink Morrow 4.0.0-beta.1 known issues and limits

Evidence date: 2026-09-01

No critical or high supported-path defect is known from the completed full
local automated suites and production dependency advisory check. That statement
remains provisional until clean-install CI, real-device smoke, manual reader
opens, and release-owner triage recorded in
[RELEASE-EVIDENCE.md](RELEASE-EVIDENCE.md).

Known limits are:

- Current Chrome Stable is the only browser tested for this beta. Other
  current standards-respecting browsers should work, but are not certified;
  reproduce browser-specific trouble in Chrome before reporting it.
- OpenRouter is the only AI supplier tested. A different
  OpenAI-compatible endpoint may lack compatible model discovery, image
  generation, narration, or reasoning controls, and may not work at all.
- `.inkmorrow` v2 archives are not encrypted. Store and transmit them using
  access-controlled encrypted systems.
- Ink Morrow 4.0 does not open 3.x databases or import format-v1 archives.
  Use the historical 3.2.2 build for historical data and preserve the original copy.
- Portable archives deliberately omit local owner/sessions, provider secrets,
  paid consent, recovery suffixes/undo credentials, and share
  capabilities/records. Use a stopped, full `DATA_DIR` copy when those local
  operational records must survive disaster recovery.
- Public sharing requires a correctly configured HTTPS reverse proxy that
  preserves but never logs `Authorization`. Direct public/LAN HTTP is unsafe.
- Automated responsive, accessibility, format, and structural visual checks do
  not replace the pending real-tablet, screen-reader, zoom, mainstream-reader,
  and visual-review checkpoints.
- The measured long-manuscript timings are from the Windows evidence host, not
  the reference Android tablet. The tablet performance baseline remains a
  release gate.

Any reproducible manuscript/canon loss, credential or private-state leak,
malformed archive/media escape, authentication bypass, public-snapshot
mutation, duplicate paid request, or inaccessible critical action is a release
blocker rather than an acceptable known issue.
