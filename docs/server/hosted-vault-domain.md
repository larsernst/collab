# Hosted Vault Domain Model

## Identity and Ownership

All IDs are server-generated UUIDv7 values unless explicitly described otherwise.

| Entity | Important fields |
| --- | --- |
| User | `id`, `username`, `displayName`, `status`, timestamps |
| Session | `id`, `userId`, refresh-token family, expiry, revoked timestamp |
| Vault | `id`, `name`, `ownerUserId`, `status`, `manifestSequence`, timestamps |
| Membership | `vaultId`, `userId`, `role`, timestamps |
| FileEntry | `id`, `vaultId`, `parentId`, `name`, `kind`, `documentType`, `state`, current revision, timestamps |
| FileRevision | `id`, `fileId`, `sequence`, content/blob hash, size, creator, timestamp |
| Snapshot | `id`, `fileId`, revision/materialized CRDT reference, label, creator, timestamp |
| StructuralOperation | `id`, `clientOperationId`, `vaultId`, actor, base/result manifest sequence, type, payload, timestamp |
| ActivityEvent | `id`, `vaultId`, actor, type, target IDs, sanitized metadata, timestamp |
| CRDTDocument | `fileId`, protocol version, snapshot, update-tail position, materialized revision |
| Blob | SHA-256 digest, size, media type, storage key, reference state |

Folders are explicit `FileEntry` records. Relative paths are derived by walking `parentId` relationships and applying the hosted path rules.

The Phase 3 online API persists stable folder/document/asset IDs and derives
relative paths from their parent relationships. Text-backed note, Kanban, and
canvas documents commit immutable content-addressed revisions using optimistic
revision sequences. Bounded binary uploads verify caller-provided SHA-256
digests and deduplicate blobs. Rename, move, trash, restore, and purge are
idempotent structural operations ordered by the vault manifest sequence.

## File Kinds and Document Types

`FileEntry.kind` is one of:

- `folder`
- `document`
- `asset`

`documentType` is required for documents and is one of:

- `note`
- `kanban`
- `canvas`

PDFs and images are assets. Hidden application metadata is represented by server tables or typed sidecar records rather than user-visible `.collab` file entries. Export materializes compatible `.collab` files where appropriate.

## File and Vault State

Vault state:

- `active`
- `archived`
- `pending_delete`

File state:

- `active`
- `trashed`
- `tombstoned`

Trash preserves the file ID, revisions, original parent/name, actor, and deletion timestamp. Purge creates a tombstone and releases blob references only after retention rules allow it.

## Revisions and Ordering

- Each file has a monotonic revision sequence.
- Each vault has a monotonic manifest sequence covering structural and committed content changes.
- REST mutations use `clientOperationId` for idempotency.
- Optimistic online writes before CRDT migration include the expected file revision.
- CRDT materialization creates normal file revisions and increments the manifest sequence.

## Roles and Permissions

The owner is a distinguished user and always has administrative permissions. Ownership can only be transferred explicitly to an existing administrator.

| Action | Viewer | Editor | Admin | Owner |
| --- | --- | --- | --- | --- |
| Read vault, files, history, and members | Yes | Yes | Yes | Yes |
| Join presence and receive awareness | Yes | Yes | Yes | Yes |
| Send chat messages | Yes | Yes | Yes | Yes |
| Edit documents and sidecars | No | Yes | Yes | Yes |
| Create, rename, move, trash, and restore | No | Yes | Yes | Yes |
| Purge trash or clear history | No | No | Yes | Yes |
| Import and export vaults | No | No | Yes | Yes |
| Invite/remove viewers and editors | No | No | Yes | Yes |
| Grant or remove admin role | No | No | No | Yes |
| Archive/delete vault or transfer ownership | No | No | No | Yes |

The server checks permissions for every REST mutation and every WebSocket subscription or update. UI checks are advisory only.

## Import and Export

Import:

- Accept ZIP archives and later native folder-upload streams.
- Reject symlinks, hard links, absolute paths, path traversal, duplicate normalized paths, unsupported path names, decompression bombs, and configured size-limit violations.
- Ignore runtime presence data.
- Preserve supported vault files and compatible `.collab` metadata.
- Generate stable hosted IDs and hosted revisions during import.
- Report rejected or repaired entries before committing the import.

Export:

- Produce a ZIP that opens as a normal local vault.
- Materialize current notes, Kanban boards, canvases, assets, and compatible sidecars.
- Include a compatible `.collab/vault.json`, snapshots/history, templates, and trash according to export options.
- Exclude sessions, credentials, server audit records, ephemeral awareness, internal CRDT logs, and runtime presence.

## Compatibility Rules

- Hosted storage does not change existing local-vault formats.
- Local-vault encryption is not carried into hosted storage. An encrypted local vault must be unlocked client-side before import.
- Hosted content is server-readable and protected through authentication, authorization, TLS, filesystem/database permissions, and encrypted infrastructure backups.
