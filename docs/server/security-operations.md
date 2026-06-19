# Security, Operations, and Compatibility

## Threat Model

The first server targets a trusted self-hosted organization, but clients and network traffic are not trusted.

The server must defend against:

- Forged identities and client-reported roles.
- Unauthorized REST and WebSocket access.
- Path traversal and access to host filesystem paths.
- Malicious archives, oversized uploads, and decompression bombs.
- Credential stuffing and token theft.
- Duplicate/replayed mutations.
- Server-side request forgery through preview fetching.
- Accidental data loss during concurrent edits, structural conflicts, upgrades, and restores.

The first version does not defend against a malicious server operator. Hosted vault content is server-readable.

## Trust Boundaries

- TLS terminates at the deployment gateway.
- The gateway forwards only to the private server network.
- PostgreSQL and blob storage are not publicly exposed.
- Server authorization is authoritative; client-side role checks improve UX only.
- The server resolves storage keys internally from opaque IDs.
- Remote web-preview fetching retains the existing private-network, redirect, credential, and response-size protections.

## Secrets and Configuration

- Secrets are supplied through environment variables or mounted secret files, never committed configuration.
- Required secrets include the access-token signing key and bootstrap credentials during first initialization.
- Production startup fails if default or weak signing secrets are detected.
- Logs redact authorization headers, cookies, passwords, refresh tokens, WebSocket tickets, and invitation secrets.
- Configuration is validated before migrations or network listeners start.

## Admin Web Interface

- The administration interface is served on the same origin below `/admin/`.
- Browser admin sessions use `Secure`, `HttpOnly`, and appropriate `SameSite`
  cookies plus CSRF protection for state-changing requests.
- A strict Content Security Policy limits scripts, connections, frames, and
  remote content.
- Admin authorization is enforced by the server for every page-data request and
  mutation; hiding controls in the browser is never an authorization boundary.
- The interface consumes typed, redacted audit events and operational summaries.
  It never exposes raw container logs, environment variables, stack traces,
  request headers, cookies, tokens, password material, or invitation secrets.
- Every administration mutation emits an audit event containing the acting user,
  action, target identifiers, result, request ID, and sanitized metadata.
- Browser session and CSRF secrets are generated from operating-system
  randomness and stored in PostgreSQL only as SHA-256 digests.
- Passwords are stored only as Argon2id hashes with per-password salts.

## Database Migrations

- Use ordered, immutable SQL migrations in the server crate.
- Migrations run under an advisory lock so only one server instance migrates.
- The server refuses to run against a schema newer than it supports.
- Forward-compatible additive migrations are preferred.
- Destructive or irreversible migrations require a verified backup and explicit operator opt-in.
- A failed migration stops startup without serving traffic.
- Rollback means restoring the pre-upgrade database and blob backup; down migrations are not relied upon.

## Backups

A valid backup contains:

- A transactionally consistent PostgreSQL backup.
- Every referenced blob and its digest.
- Server configuration excluding replaceable runtime secrets.
- A manifest recording versions, timestamps, and checksums.

Backup and blob retention must prevent garbage collection from deleting content needed by an in-progress backup. Restore testing is required before production readiness.

## Rate Limiting

- Authentication endpoints keep a per-username login attempt limiter (5 attempts
  per minute) that resets on success.
- A coarse per-client-IP limiter protects all `/api/v1/*` (REST) and `/ws/v1/*`
  (WebSocket upgrade) traffic, tuned by `COLLAB_REST_RATE_LIMIT_PER_MINUTE`
  (default 1200) and `COLLAB_WS_RATE_LIMIT_PER_MINUTE` (default 120); either set
  to `0` disables that limiter. Exceeding a limit returns `429 RATE_LIMITED` with
  a `Retry-After` header. Health checks, the admin SPA, and the root redirect are
  never rate limited.
- The client identity is the last `X-Forwarded-For` hop appended by the trusted
  reverse proxy (falling back to `X-Real-IP`, then the socket peer). This trusts
  the front proxy to set `X-Forwarded-For`; do not expose the server port
  directly to untrusted clients without a proxy that overwrites that header.
- Each authenticated WebSocket additionally has a generous per-connection inbound
  message flood guard (2,000 frames per 10 seconds) that disconnects a runaway or
  hostile socket; the client reconnects and re-syncs through the state-vector
  handshake. Ping/pong keepalives are exempt.

## Import and Upload Limits

Configurable limits apply to:

- Total vault import size.
- Single file size.
- Archive entry count.
- Compressed-to-expanded size ratio.
- Request body size.
- Concurrent uploads per user and server.

The initial hosted asset endpoint enforces `COLLAB_MAX_FILE_BYTES` after base64
decoding and verifies the supplied SHA-256 digest before committing metadata.
The HTTP JSON body limit is derived from `COLLAB_MAX_FILE_BYTES` with base64
and envelope overhead so valid asset and ZIP imports are accepted without
falling through Axum's smaller default body limit. Concurrent-upload limits
remain required before production exposure.

Future streaming archive import should extract into an isolated staging
location, validate every entry, and commit metadata only after validation
succeeds.

The initial hosted ZIP endpoint validates entries in memory before commit,
rejects symlinks and unsafe portable paths, limits archives to 1,000 entries,
limits individual files with `COLLAB_MAX_FILE_BYTES`, compressed archives with
`COLLAB_MAX_IMPORT_BYTES`, and total expanded content with
`COLLAB_MAX_IMPORT_EXPANDED_BYTES`. Defaults are 256 MiB per file, 512 MiB
compressed, and 2 GiB expanded. Operators must keep these limits aligned with
available container memory until import becomes streaming/staged.

## Compatibility Policy

- API and WebSocket protocol major versions are explicit.
- The server supports the current native client protocol and at least one previous compatible minor release during normal upgrades.
- Database schema and CRDT materializer versions are recorded.
- Exports remain compatible with the existing local vault layout.
- Existing local vaults are never silently converted into hosted replicas.
