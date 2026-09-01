# Immutable snapshot sharing

PR 17 exposes a reviewed `PublicationDocument`, never a live manuscript. A
share row points at one append-only publication snapshot. New pages, display
copyedits, art changes, recovery work, and provider activity after creation do
not alter the reader response or its SHA-256 digest.

## Capability lifecycle

- Creation generates 32 cryptographically random bytes and returns the
  base64url capability once in `/share/#…`.
- The fragment is not sent in the initial HTTP request, browser referrers, or
  ordinary proxy access logs. The isolated viewer sends it only as
  `Authorization: Share …` to `GET /api/public-share`.
- SQLite stores only `SHA-256(capability)`. Owner listings contain status,
  snapshot digest, creation, expiry, and revocation times, but no recoverable
  link.
- Expiry is fixed at creation. Revocation is one-way and enforced by schema-9
  triggers; revoked, expired, malformed, and unknown capabilities all return
  the same cache-disabled 404 response.

The capability grants access to the reading copy. Anyone who receives it can
read that snapshot until expiry or revocation, so send it through an
appropriate private channel.

## Viewer isolation

`/share/` serves a dedicated HTML document and one small renderer. It does not
load the authenticated application bootstrap, private state, provider code, or
owner session adapter. Its only request is the capability endpoint with
credentials omitted. Rendering uses DOM text nodes and allowlisted image data
from the frozen document; publication prose cannot become executable markup.

The public response contains the publication schema only. Story/page IDs,
directions, continuity, prepared prose, recovery suffixes, prompts, provider
traces, costs, credentials, sessions, and working history do not exist in that
schema.

## HTTPS and reverse proxy operation

Public links must be served over HTTPS. Bind ScribeTribe to loopback and place
the TLS reverse proxy on the same machine. Set `ALLOWED_HOSTS` to the exact
public hostname and set `TRUST_PROXY=1` only for that loopback proxy. Do not set
`ALLOW_INSECURE_LAN=1` for public sharing.

Preserve the `Authorization` header when proxying `/api/public-share`, but never
record it in access logs, tracing, analytics, error reports, or support dumps.
Disable intermediary caching for `/share/` and `/api/public-share`; the app also
sends `no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, CSP,
frame-denial, and HSTS on secure requests. Terminate TLS before any untrusted
network hop and restrict direct access to the loopback application port.

Revocation is the response to suspected disclosure. Because only a hash is
stored, a lost raw link cannot be recovered; create a new link instead.
