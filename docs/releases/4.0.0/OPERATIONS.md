# Ink Morrow 4.0.0 beta operations

This runbook covers a single-owner, self-hosted Ink Morrow 4.0.0-beta.1
installation. Run Node.js 22.5 or newer and keep the application bound to
`127.0.0.1` unless a deliberate temporary LAN exception is required.

Chrome is the only browser tested for this beta. OpenRouter is the only AI
supplier tested; another OpenAI-compatible endpoint may be incomplete or fail
entirely, especially for image generation, narration, model discovery, and
reasoning controls.

## Storage and backup boundaries

`DATA_DIR` owns the SQLite database, normalized images, audio, transfer staging,
and persistent safety backups. `DB_PATH` is an advanced override for the SQLite
file; when it is set without `DATA_DIR`, media follows the database directory.

Use both of these backup forms:

1. In Gate, create a **full `.inkmorrow` backup** with visuals, audio, and
   working history selected. Download it and keep it on encrypted storage.
2. During a maintenance window with Ink Morrow stopped, make a cold filesystem
   copy of the entire `DATA_DIR`. This is the disaster-recovery image that also
   preserves local-only owner, session, recovery, and share state.

A portable archive is intentionally unencrypted. It excludes passwords,
sessions, provider secrets, paid-action consent, recovery suffixes and undo
credentials, and public-share capabilities/records. Publication snapshots are
included because they are durable reading copies. Protect the archive as you
would the manuscript itself.

## Clean backup, upgrade, and restore

Before an upgrade:

1. Record the installed commit, Node version, and current `DATA_DIR`/`DB_PATH`.
2. Lock out new work, wait for active publication or provider jobs to settle,
   and create/download the full Gate backup.
3. Stop Ink Morrow cleanly and copy the complete data directory to a dated,
   access-controlled location.
4. Install the reviewed release with `npm ci` at the repository root and in
   `backend`, `frontend`, and `e2e` as needed. Production-only installs may use
   `npm ci --omit=dev` in `backend`.
5. Start 4.0 against a **new, empty** `DATA_DIR`. Do not point it at a 3.x
   database: 4.0 refuses the old family before schema writes.
6. Sign in, open Gate, preflight the backup, review its exposure/collisions,
   and choose **Replace everything** only for an intentional full restore.
   Ink Morrow first writes another safety archive under
   `database/transfers/backups/`.
7. Verify manuscript hierarchy, page/revision order, continuity, selected
   media, prepared work, publication snapshots, and sanitized settings. Export
   the restored story again and confirm its semantic digest and media hashes
   match the source evidence.

To recover from a failed upgrade, stop the application and restore the cold
data-directory copy as one unit. Never mix a database from one backup with
media or transfer directories from another. Start the previous reviewed build,
then validate the catalogue before resuming authoring.

Ink Morrow 4.0 does not import 3.x format-v1 archives. Open those archives in
the historical 3.2.2 build, then move authored content through an explicitly supported
path. Future archive/database versions and unknown families are also refused
before catalogue writes.

## HTTPS reverse proxy and public sharing

Public snapshot sharing requires HTTPS. Keep Ink Morrow on loopback and set:

For operators new to these terms: loopback means the application accepts only
connections originating on the same computer. HTTPS encrypts traffic between
the reader's browser and the front-door proxy. The proxy then passes that
request locally to Ink Morrow. Plain HTTP on a LAN does not provide that
transport protection.

```text
HOST=127.0.0.1
PORT=3000
ALLOWED_HOSTS=scribe.example.com
TRUST_PROXY=1
```

Do not set `ALLOW_INSECURE_LAN=1` for an Internet-facing deployment. The proxy
must preserve `Host`, set `X-Forwarded-Proto: https`, forward the
`Authorization` header, and neither cache nor log the share capability.

Example Nginx server block:

```nginx
server {
    listen 443 ssl http2;
    server_name scribe.example.com;

    ssl_certificate     /etc/letsencrypt/live/scribe.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/scribe.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization $http_authorization;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }

    location = /api/public-share {
        access_log off;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization $http_authorization;
        proxy_no_cache 1;
        proxy_cache_bypass 1;
        add_header Cache-Control "private, no-store" always;
    }
}
```

The raw 256-bit share capability appears only in the URL fragment returned at
creation time and in the viewer's `Authorization: Share ...` request. It must
never be copied into a query string, proxy path, analytics event, referrer, or
log. Revoke a share in Gate as soon as it is no longer needed; revocation and
expiry fail closed. Create a new snapshot/share after material manuscript
changes rather than attempting to mutate an existing publication.

## Credentials, incidents, and logs

- Rotate provider credentials at the provider first, then replace the saved
  secret in Ink Morrow. A password change revokes other owner sessions.
- If owner access is lost, stop the server and run
  `npm run auth:reset -- --yes` from `backend`; this removes only the local
  owner and sessions. It does not decrypt or export a forgotten provider key.
- Treat an exposed archive as manuscript disclosure. Treat an exposed share
  capability as public access: revoke the share and issue a fresh one only if
  still required. Treat an exposed provider key as a provider incident and
  revoke it immediately.
- Preserve a cold copy and relevant redacted logs before repair. Never attach
  the live database, archives, Authorization headers, cookies, CSRF tokens,
  setup codes, prompts, prose, recovery payloads, or provider responses to a
  public issue.
- Configure proxy/application logging to omit request bodies and
  `Authorization`, `Cookie`, and `Set-Cookie` headers. Scrub share tokens,
  filenames, story text, provider errors, and local paths before sharing logs.
