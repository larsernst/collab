# Collaboration Server Protocol

## Versioning

- REST endpoints are rooted at `/api/v1`.
- WebSocket endpoints are rooted at `/ws/v1`.
- Clients send `X-Collab-Client-Version` and `X-Collab-Protocol-Version`.
- The server returns its supported protocol version and rejects incompatible clients with `protocol_version_unsupported`.
- Breaking changes require a new major API path. Additive fields within a major version are allowed.

## REST Conventions

- JSON uses camelCase.
- IDs are opaque strings.
- Timestamps are UTC RFC 3339 strings.
- Collection endpoints use cursor pagination with `items` and `nextCursor`.
- Mutations include `clientOperationId` where retry is possible.
- Binary transfers use dedicated upload/download endpoints. The initial bounded
  upload endpoint accepts base64 JSON; resumable streaming sessions replace it
  for larger transfers in a later phase.

Successful single-resource response:

```json
{
  "data": {}
}
```

Successful collection response:

```json
{
  "data": {
    "items": [],
    "nextCursor": null
  }
}
```

Error response:

```json
{
  "error": {
    "code": "vault_permission_denied",
    "message": "You do not have permission to modify this vault.",
    "requestId": "019...",
    "details": {}
  }
}
```

The server returns safe user-facing messages. Internal errors and secrets remain in structured server logs keyed by `requestId`.

## Stable Error Codes

Initial error families:

- `authentication_required`
- `authentication_invalid`
- `session_expired`
- `session_revoked`
- `user_disabled`
- `rate_limited`
- `resource_not_found`
- `validation_failed`
- `path_invalid`
- `path_conflict`
- `vault_permission_denied`
- `vault_archived`
- `revision_conflict`
- `manifest_conflict`
- `operation_conflict`
- `operation_already_applied`
- `upload_incomplete`
- `upload_hash_mismatch`
- `quota_exceeded`
- `protocol_version_unsupported`
- `server_unavailable`

## Initial Endpoint Groups

Authentication and administration:

- `GET /api/v1/auth/bootstrap-status`
- `POST /api/v1/auth/bootstrap`

Bootstrap-status responses use `Cache-Control: no-store` so browsers and
gateways cannot replay the initial first-run result after an administrator has
been created or the server has restarted.
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/native/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/native/logout`
- `POST /api/v1/auth/invitations/{token}/accept`
- `POST /api/v1/auth/ws-ticket`
- `GET /api/v1/users/me`
- `POST /api/v1/users/me/password`
- `GET|POST /api/v1/admin/users`
- `PATCH|DELETE /api/v1/admin/users/{userId}`
- `POST /api/v1/admin/users/{userId}/revoke-sessions`
- `POST /api/v1/admin/users/{userId}/reset-password`
- `GET /api/v1/admin/users/{userId}/activity`
- `GET|POST /api/v1/admin/invitations`
- `POST /api/v1/admin/invitations`
- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/audit-events`
- `GET /api/v1/admin/operational-warnings`
- `GET /api/v1/admin/vaults`
- `GET|PATCH|DELETE /api/v1/admin/vaults/{vaultId}`
- `GET|POST /api/v1/admin/vaults/{vaultId}/members`
- `PATCH|DELETE /api/v1/admin/vaults/{vaultId}/members/{userId}`
- `GET /api/v1/admin/vaults/{vaultId}/activity`

Browser administration uses the same administration resources but authenticates
with a hardened same-origin browser session and CSRF protection. Native clients
use short-lived opaque access tokens and rotating opaque refresh tokens. Reuse
of a rotated refresh token revokes its native session. The desktop keeps access
tokens in memory and refresh tokens in the operating system credential store.
Administration collection endpoints return only typed, redacted data.
The first bootstrapped administrator is marked as the primary administrator;
status updates cannot disable it and the user deletion endpoint rejects it.

Administration vault endpoints act with server-operator authority and do not
require vault membership. `GET /admin/vaults/{vaultId}` returns a
`HostedVaultAdminDetail` with status, manifest sequence, member count,
active/trashed file counts, and storage usage. `PATCH` renames or moves a vault
between `active` and `archived` (including restoring a pending-delete vault);
`DELETE` marks it pending deletion. Member endpoints add, re-role, and remove
members but never modify the owner membership, and member mutations are
rejected while a vault is pending deletion. Every administration vault mutation
records both an audit event and a vault activity event flagged
`byServerAdmin`.

Vault management:

- `GET|POST /api/v1/vaults`
- `GET|PATCH|DELETE /api/v1/vaults/{vaultId}`
- `GET|POST /api/v1/vaults/{vaultId}/members`
- `PATCH|DELETE /api/v1/vaults/{vaultId}/members/{userId}`
- `POST /api/v1/vaults/{vaultId}/import`
- `POST /api/v1/vaults/{vaultId}/export`

The initial Phase 3 vault-management slice is implemented. Creating a vault
makes the authenticated user its owner and administrator. Listings expose only
vaults where the authenticated user has a persisted membership. Vault
administrators can rename vaults and manage viewer/editor memberships; only the
owner can grant or remove administrators, archive a vault, or mark it pending
deletion. Archived and pending-delete vaults reject membership mutations.

Files and history:

- `GET /api/v1/vaults/{vaultId}/manifest`
- `GET|POST /api/v1/vaults/{vaultId}/files`
- `GET|PATCH|DELETE /api/v1/vaults/{vaultId}/files/{fileId}`
- `GET|POST /api/v1/vaults/{vaultId}/files/{fileId}/revisions`
- `GET /api/v1/vaults/{vaultId}/files/{fileId}/revisions/{revisionId}`
- `GET|POST /api/v1/vaults/{vaultId}/files/{fileId}/snapshots`
- `POST /api/v1/vaults/{vaultId}/files/{fileId}/snapshots/{snapshotId}/restore`
- `POST /api/v1/vaults/{vaultId}/operations`
- `POST /api/v1/vaults/{vaultId}/operations/preview`
- `GET /api/v1/vaults/{vaultId}/files/{fileId}/references`
- `POST /api/v1/vaults/{vaultId}/uploads`
- `GET /api/v1/vaults/{vaultId}/files/{fileId}/content`
- `GET /api/v1/vaults/{vaultId}/activity`
- `GET /api/v1/vaults/{vaultId}/search`

The Phase 3 manifest and text-revision slice implements:

- `GET /manifest` and `GET /files` with stable file IDs and derived relative
  paths.
- `POST /files` for folders and text-backed note, Kanban, and canvas documents.
- `GET /files/{fileId}` for the current materialized text content.
- `GET|POST /files/{fileId}/revisions` for history and optimistic writes using
  `expectedRevisionSequence`.

Each successful create or text revision increments the vault manifest sequence
and records vault activity. Text payloads use the content-addressed blob store.
Viewer reads are allowed; mutations require editor access and an active vault.

The binary and structural-operation slice also implements:

- `POST /uploads` for bounded base64 assets with a required SHA-256 digest,
  content-addressed blob deduplication, and a configurable per-file limit.
- `GET /files/{fileId}/content` for authenticated raw content downloads with
  digest verification.
- `POST /operations` for idempotent rename, move, trash, restore, and purge.
  Operations target stable file IDs and include `clientOperationId` and
  `baseManifestSequence`; stale manifests return `manifest_conflict`.
- Editor access for rename, move, trash, and restore. Purge requires vault
  administrator access.
- `GET /revisions/{revisionId}` returns immutable historical text content for
  comparison views.
- `GET|POST /snapshots` lists or labels immutable revisions. Snapshot creation
  does not advance the manifest because it does not change file content.
- `POST /snapshots/{snapshotId}/restore` requires
  `expectedRevisionSequence`, creates a new immutable revision, advances the
  vault manifest, and preserves the intervening history.

The reference-impact slice also implements:

- `GET /files/{fileId}/references` lists where an active file is referenced by
  note links and wikilinks, Kanban attachments, and canvas file/note nodes.
  Viewer access is sufficient because the listing is read-only.
- `POST /operations/preview` returns a non-mutating
  `HostedStructuralOperationPreview` with the old and new relative paths, the
  nested active item count, the documents whose references would be rewritten,
  and a `blockedReason` instead of an error when the operation cannot apply
  (for example a destination collision). Preview requires the same role the
  previewed operation would require.
- Rename and move operations rewrite affected references in other active
  documents inside the same transaction. Each rewritten document receives a
  new revision attributed to the acting user, and a `file.references_rewritten`
  activity event records the rewritten document IDs. Trash accepts an optional
  `removeReferences` flag that removes references instead. Reference analysis
  and rewriting share `collab-core` logic with the native local-vault flows;
  unparseable board or canvas documents are skipped rather than blocking the
  operation.
- `HostedStructuralOperationResult` now includes `rewrittenDocumentIds`, which
  is preserved for idempotent replays of the same `clientOperationId`.

Resumable streaming upload sessions remain a later Phase 4 task.

## WebSocket Protocol

Connection:

1. Obtain a single-use ticket with `POST /api/v1/auth/ws-ticket`.
2. Connect to `/ws/v1/vaults/{vaultId}`.
3. Send an `authenticate` control message containing the ticket.
4. Server validates membership and returns `ready` with the current manifest sequence.

Control messages are JSON text frames with:

```json
{
  "type": "document.subscribe",
  "messageId": "019...",
  "payload": {}
}
```

Initial message types:

- `authenticate`
- `ready`
- `document.subscribe`
- `document.unsubscribe`
- `document.sync`
- `awareness.update`
- `manifest.updated`
- `operation.conflict`
- `chat.send`
- `chat.message`
- `error`
- `ping`
- `pong`

CRDT updates use binary frames with a compact header containing message type, protocol version, and file ID. Awareness and chat are rate-limited separately from durable document updates.

## Idempotency and Concurrency

- The server records accepted `clientOperationId` values and returns the original result for safe retries.
- REST content writes before CRDT migration require an expected revision.
- Structural operations use stable file IDs and a base manifest sequence.
- The server may rebase a stale structural operation only when its result is unambiguous.
- Conflicts return structured recovery data and never silently discard content.
