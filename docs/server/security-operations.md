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

## Import and Upload Limits

Configurable limits apply to:

- Total vault import size.
- Single file size.
- Archive entry count.
- Compressed-to-expanded size ratio.
- Request body size.
- Concurrent uploads per user and server.

Archive import extracts into an isolated staging location, validates every entry, and commits metadata only after validation succeeds.

## Compatibility Policy

- API and WebSocket protocol major versions are explicit.
- The server supports the current native client protocol and at least one previous compatible minor release during normal upgrades.
- Database schema and CRDT materializer versions are recorded.
- Exports remain compatible with the existing local vault layout.
- Existing local vaults are never silently converted into hosted replicas.
