# ADR 0004: Offline Synchronization

- Status: Accepted
- Date: 2026-06-09

## Decision

The native client maintains a managed replica for each hosted vault. Offline synchronization separates document-content updates from structural operations.

- CRDT content synchronizes using state vectors and missing updates.
- File create, rename, move, trash, restore, and delete synchronize as ordered structural operations.
- Every client mutation has a stable `clientOperationId`; retrying the same operation is idempotent.
- Structural operations include the client's last known manifest sequence and target stable file IDs.
- The server serializes accepted structural operations and returns the resulting manifest sequence.
- Non-conflicting operations against stale manifests may be rebased by stable ID.
- Conflicting structural operations do not use last-write-wins. The server returns a recoverable conflict record and preserves all content.
- Binary uploads use resumable upload sessions and content hashes. File revisions reference a blob only after upload completion.
- A revoked client may retain its local replica but cannot submit operations after reconnecting.
- The managed replica is application data and must not be presented as an ordinary local vault.

## Structural Conflict Defaults

- Concurrent edits to document content converge through CRDT updates.
- Rename versus content edit applies both operations.
- Rename versus rename accepts the first committed rename and returns a conflict for the later rename.
- Delete or trash versus content edit preserves the edited content in the trashed item and reports the state to the later client.
- Delete versus move or rename returns a conflict; deletion never silently destroys unacknowledged local content.
- Name collisions require explicit user resolution with a server-suggested available name.

## Rationale

CRDTs are suitable for document content but do not safely define user intent for file-tree operations. A separate manifest operation log makes structural conflicts visible and recoverable.

## Consequences

- The native replica needs durable CRDT state, manifest state, pending operations, cached blobs, and conflict records.
- The server must retain operation IDs long enough to make retries safe.
- Sync status and conflict recovery are first-class product UI, not hidden background behavior.
