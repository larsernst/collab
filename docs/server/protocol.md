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
- Binary transfers use dedicated upload/download endpoints rather than JSON data URLs.

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

Browser administration uses the same administration resources but authenticates
with a hardened same-origin browser session and CSRF protection. Native clients
use short-lived opaque access tokens and rotating opaque refresh tokens. Reuse
of a rotated refresh token revokes its native session. The desktop keeps access
tokens in memory and refresh tokens in the operating system credential store.
Administration collection endpoints return only typed, redacted data.
The first bootstrapped administrator is marked as the primary administrator;
status updates cannot disable it and the user deletion endpoint rejects it.

Vault management:

- `GET|POST /api/v1/vaults`
- `GET|PATCH|DELETE /api/v1/vaults/{vaultId}`
- `GET|POST /api/v1/vaults/{vaultId}/members`
- `PATCH|DELETE /api/v1/vaults/{vaultId}/members/{userId}`
- `POST /api/v1/vaults/{vaultId}/import`
- `POST /api/v1/vaults/{vaultId}/export`

Files and history:

- `GET /api/v1/vaults/{vaultId}/manifest`
- `GET|POST /api/v1/vaults/{vaultId}/files`
- `GET|PATCH|DELETE /api/v1/vaults/{vaultId}/files/{fileId}`
- `GET|POST /api/v1/vaults/{vaultId}/files/{fileId}/revisions`
- `GET|POST /api/v1/vaults/{vaultId}/files/{fileId}/snapshots`
- `POST /api/v1/vaults/{vaultId}/operations`
- `POST /api/v1/vaults/{vaultId}/uploads`
- `PATCH /api/v1/vaults/{vaultId}/uploads/{uploadId}`
- `POST /api/v1/vaults/{vaultId}/uploads/{uploadId}/complete`
- `GET /api/v1/vaults/{vaultId}/activity`
- `GET /api/v1/vaults/{vaultId}/search`

Operations that modify structure are submitted to `/operations` with a stable target file ID, `clientOperationId`, and `baseManifestSequence`.

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
