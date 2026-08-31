# ScribeTribe security

ScribeTribe is a single-owner application intended to run on a local machine. Version 3.2.1 adds an access-control boundary sized for that purpose; it does not turn the project into a public multi-user service.

This file documents the current 3.2.2 release boundary. The accepted target
threat model for uploads, encrypted provider credentials, immutable sharing,
and the 4.0.0 beta is
[docs/releases/4.0.0/SECURITY-THREAT-MODEL.md](docs/releases/4.0.0/SECURITY-THREAT-MODEL.md).
Those capabilities are not shipped until their implementation PRs merge.

## Supported version

Security fixes are made on the current release line. Upgrade to the newest tagged release before reporting behavior that may already have been corrected.

## What the seal protects

- On an empty installation, the server prints a random one-time setup code. The browser must present that code before it can set the owner password.
- The owner password must contain 15–128 Unicode characters. It is normalized, salted independently, and hashed asynchronously with scrypt; plaintext is never stored.
- Successful setup/login creates a random opaque session token. Only its SHA-256 digest is stored in SQLite. The cookie is `HttpOnly`, `SameSite=Strict`, and becomes `Secure` when ScribeTribe is reached through HTTPS.
- A remembered session has a 7-day idle timeout and a 30-day absolute lifetime. An unremembered browser session has an 8-hour idle timeout and a 24-hour absolute lifetime.
- Every private API is authenticated before its body is parsed. State-changing requests also require the session's random CSRF token plus a same-origin request.
- Unlock/setup failures receive progressive delays and a temporary 10-attempt/15-minute limit. Restarting the local process clears that in-memory attempt history; it never permanently locks the owner out.
- The server rejects unapproved Host headers, limiting DNS-rebinding attacks. It sends a restrictive Content Security Policy, framing prohibition, MIME-sniffing protection, privacy-oriented referrer/permissions policies, and private no-store caching for authenticated APIs.
- Ordinary JSON bodies are limited to 256 KiB. The one image-page route has a separate 12 MiB limit; import streaming has its own archive limits and staged validation.
- Provider errors and unexpected server errors are sanitized before reaching the browser. Unexpected errors receive a correlation reference in the server log.
- New local storage/config files use owner-only permissions where the operating system supports POSIX modes. Production setup installs only backend runtime dependencies.

The cryptographic password work happens only at setup/login/password change, not on ordinary page turns. Session lookup is indexed, session activity writes are throttled, and no security background poll is added, preserving the low-powered-device target.

## First login and daily use

1. Start ScribeTribe with `./start.sh`.
2. Open `http://localhost:3000` on that machine.
3. Copy the one-time setup code printed by the server into the first-login screen.
4. Choose a distinctive password or passphrase of at least 15 characters. Spaces and Unicode are allowed.
5. Leave **Keep this scriptorium unlocked on this device** selected only on a device you control.

Use **Lock** in the main navigation to revoke the current session. Change the password under **Settings → Security**; doing so revokes all other browser sessions immediately.

If the password is forgotten, stop the server and run:

```bash
cd backend
npm run auth:reset -- --yes
```

That command deletes only the password record and sessions. Stories, worlds, characters, settings, continuity, images, audio, and transfer archives remain intact. The next server start prints a new setup code.

## Network access

The default `HOST=127.0.0.1` accepts connections only from the same machine.

For durable access from other devices, put an HTTPS reverse proxy on the same machine and leave ScribeTribe bound to loopback. Add the proxy's public hostname to `ALLOWED_HOSTS`, set `TRUST_PROXY=1`, and configure the proxy to preserve `Host` and send `X-Forwarded-Proto: https`. `TRUST_PROXY` trusts forwarding information only from a loopback peer.

Direct LAN HTTP is an explicit escape hatch:

```dotenv
HOST=0.0.0.0
ALLOW_INSECURE_LAN=1
```

This sends the password, session cookie, manuscripts, generated media, and API traffic without transport encryption. Use it only on a network you trust and understand; never expose that configuration directly to the public internet.

## Important limits

The login is access control, not encryption:

- The SQLite database, images, and audio are plaintext files. Anyone who can read the account's files—or an unencrypted disk after theft—can read them without the web password.
- Portable `.scribetribe` exports are ZIP containers and are not encrypted. The exposure review shows what is included; store/share them accordingly. Login credentials, sessions, API keys, and paid-consent state are never exported.
- `backend/.env` contains the provider key. Use a dedicated OpenRouter key with a hard spend limit and protect the operating-system account.
- A malicious administrator/root user, compromised OS, browser extension, reverse proxy, or provider is outside this boundary.
- There is one owner only: no usernames, roles, remote recovery, MFA, email, or account sharing.
- Public internet deployment is outside the supported threat model, even behind TLS.

Full-device encryption and encrypted backups remain the right controls for data at rest. Archive encryption may be added separately in a future format revision.

## Updates and dependencies

CI pins third-party GitHub Actions to immutable commits and audits production dependencies. Dependabot checks npm packages and Actions weekly. Review dependency-update pull requests and keep Node.js on a supported release.

The password work factor follows OWASP's 32 MiB scrypt profile (`N=2^15`, `r=8`, `p=3`), while the random 16-byte salt and asynchronous implementation follow Node's crypto guidance. Session expiry, strict SameSite plus a separate CSRF token, and server-side revocation follow OWASP's password, session, and CSRF guidance.

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node.js `crypto.scrypt` documentation](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)

## Reporting a vulnerability

Please avoid posting exploitable details in a public issue. Use the repository's [private security advisory form](https://github.com/rthorman/scribe-tribe/security/advisories/new). Include the affected version, deployment shape, reproduction steps, and impact; do not include real manuscripts, passwords, session cookies, or provider keys.

The operational and data boundaries are also summarized in
[LEGAL.md](LEGAL.md) and [PRIVACY.md](PRIVACY.md).
