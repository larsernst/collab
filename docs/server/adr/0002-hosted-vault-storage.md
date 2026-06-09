# ADR 0002: Hosted Vault Storage

- Status: Accepted
- Date: 2026-06-09

## Decision

PostgreSQL is authoritative for hosted vault metadata, structure, permissions, revisions, and operation ordering. File payloads are stored through a content-addressed blob-storage interface.

- Vaults, files, folders, users, and revisions use server-generated UUIDv7 identifiers.
- Files and folders retain stable IDs across rename, move, trash, and restore operations.
- PostgreSQL stores the file tree, revision metadata, hashes, tombstones, memberships, snapshots, activity, and a monotonic manifest sequence per vault.
- Blob payloads are addressed by SHA-256 digest. Initial deployments use a persistent local filesystem backend.
- The blob-storage interface must permit a later S3-compatible implementation.
- The server never accepts or exposes its own filesystem paths.
- Each committed structural or content operation increments the vault manifest sequence in the same database transaction.
- Blobs are written before metadata commits and garbage-collected only after no live revision, snapshot, or retention record references them.

## Path Rules

- API paths are normalized UTF-8 POSIX-style relative paths using `/`.
- Names are normalized to Unicode NFC.
- Empty components, `.`, `..`, absolute paths, NUL, and backslashes are rejected.
- `.collab` is reserved at the vault root for export compatibility.
- Sibling names must be unique under Unicode case folding to remain portable across common desktop filesystems.
- Windows reserved device names and names ending in a dot or space are rejected.
- Maximums are 255 UTF-8 bytes per name and 4096 UTF-8 bytes per complete relative path.

## Rationale

Stable IDs allow offline structural operations to target the same logical item after a rename. PostgreSQL transactions provide reliable ordering and permission enforcement, while content-addressed blobs avoid duplicating binary payloads.

## Consequences

- Relative paths are derived display and export data, not identity.
- Blob storage and PostgreSQL must be backed up together.
- Structural operations must lock or serialize against the vault manifest sequence.
- Import must reject or explicitly repair local vault paths that violate hosted portability rules.
