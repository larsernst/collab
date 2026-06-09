# Collaboration Server Implementation Tracker

## Goal

Build a self-hosted collaboration server distributed through Docker Compose.

The server will become authoritative for hosted vaults, authenticated users, permissions, live collaboration, history, and synchronization. The native Tauri app will gain a hosted-vault mode while retaining its existing local-vault mode.

This document is the source of truth for implementation progress. Update task checkboxes and the status table whenever server work lands.

## Status Summary

| Phase | Status | Completion |
| --- | --- | --- |
| 0. Architecture and prerequisites | Complete | 100% |
| 1. Server foundation and Compose | Not started | 0% |
| 2. Authentication and administration | Not started | 0% |
| 3. Hosted vault storage and permissions | Not started | 0% |
| 4. Native hosted-vault client | Not started | 0% |
| 5. Live collaboration | Not started | 0% |
| 6. Full offline synchronization | Not started | 0% |
| 7. Production hardening | Not started | 0% |

Status values:

- `Not started`: implementation has not begun.
- `In progress`: at least one task is implemented, but the completion gate is not satisfied.
- `Blocked`: work cannot continue until a recorded blocker is resolved.
- `Complete`: every required task and completion-gate check is satisfied.

## Current Repository Baseline

These capabilities already exist and should be reused or preserved:

- [x] Native Tauri application with typed frontend IPC wrappers.
- [x] Local filesystem vaults with relative-path validation.
- [x] Optimistic note writes with hashes and text auto-merge support.
- [x] Local vault member metadata with `viewer`, `editor`, and `admin` roles.
- [x] Local presence, chat, snapshots, trash, and activity concepts.
- [x] Local note, Kanban, canvas, PDF, image, template, and search workflows.
- [x] Existing frontend collaboration transport abstraction.

These server capabilities do not currently exist:

- [ ] Standalone collaboration server process.
- [ ] Docker Compose server deployment.
- [ ] Server-authenticated users and sessions.
- [ ] Server-enforced hosted-vault permissions.
- [ ] Canonical hosted-vault storage.
- [ ] Native hosted-vault client mode.
- [ ] Server-backed CRDT live collaboration.
- [ ] Durable offline hosted-vault replicas.

## Fixed Architecture Decisions

- The first deployment model is one trusted organization per self-hosted server.
- Hosted vaults are canonical on the server and server-readable.
- Existing arbitrary local vaults remain supported.
- The native Tauri app remains the primary client.
- Hosted notes, Kanban boards, and canvases ultimately support true live co-editing.
- Hosted vaults ultimately support full offline editing.
- PostgreSQL stores users, sessions, memberships, manifests, and collaboration metadata.
- Binary assets initially use persistent local filesystem storage behind a blob-storage abstraction.
- The server API uses opaque vault and file IDs and never accepts arbitrary server filesystem paths.
- GitHub-built container images and a possible web app are outside the initial server implementation.

Approved Phase 0 architecture:

- [Server Architecture Index](./docs/server/README.md)
- [Hosted Vault Domain Model](./docs/server/hosted-vault-domain.md)
- [REST and WebSocket Protocol](./docs/server/protocol.md)
- [Security, Operations, and Compatibility](./docs/server/security-operations.md)
- [Workspace and Verification](./docs/server/workspace-verification.md)

---

## Phase 0: Architecture and Prerequisites

**Objective:** Establish contracts and boundaries before introducing a server or changing existing local-vault behavior.

**Estimated effort:** 1-2 weeks.

### Tasks

- [x] Create architecture decision records for authentication, hosted-vault storage, CRDT persistence, and offline synchronization.
- [x] Define the hosted-vault domain model:
  - Stable vault IDs and file IDs.
  - Relative paths as mutable file metadata.
  - Membership and role rules.
  - File revisions, tombstones, trash, snapshots, and activity events.
- [x] Define versioned REST and WebSocket protocol contracts.
- [x] Define a common error envelope and stable error codes.
- [x] Define server configuration and secret-management conventions.
- [x] Define database migration and compatibility policy.
- [x] Define import/export compatibility with existing local vault layouts.
- [x] Document threat model, trust boundaries, and expected backup model.
- [x] Decide the Rust workspace layout for `collab-core`, Tauri, and the server.
- [x] Record the verification commands required for server changes.

### Completion Gate

- [x] The protocol and data model are documented well enough to implement without unresolved storage or identity decisions.
- [x] The migration path preserves existing local-vault behavior.
- [x] Security-sensitive flows have explicit server-side enforcement rules.

---

## Phase 1: Server Foundation and Compose

**Objective:** Produce a runnable, testable server skeleton with persistent infrastructure.

**Estimated effort:** 2-4 weeks.

### Tasks

- [ ] Convert the Rust backend into a workspace without breaking Tauri builds.
- [ ] Add a reusable `collab-core` crate for shared vault rules and models.
- [ ] Add a standalone `collab-server` Rust binary.
- [ ] Add structured configuration from environment variables and config files.
- [ ] Add structured logging and request correlation IDs.
- [ ] Add liveness and readiness endpoints.
- [ ] Add PostgreSQL connection management and migrations.
- [ ] Add persistent local blob storage behind a storage trait.
- [ ] Add a development `compose.yaml` with:
  - `collab-server`
  - `postgres`
  - `gateway`
  - Persistent data and backup volumes
- [ ] Add Caddy routing and local TLS/development HTTP configuration.
- [ ] Add graceful startup, shutdown, and migration behavior.
- [ ] Add server integration-test infrastructure.
- [ ] Document local server development and Compose operation.

### Completion Gate

- [ ] `docker compose up` starts a healthy server and PostgreSQL from a clean checkout.
- [ ] Database migrations run safely and idempotently.
- [ ] Server data survives container recreation.
- [ ] Tauri local-vault behavior and existing tests remain green.

---

## Phase 2: Authentication and Administration

**Objective:** Establish trustworthy server identities before hosted vault mutations are exposed.

**Estimated effort:** 3-5 weeks.

### Tasks

- [ ] Implement the user, credential, session, invitation, and audit-event tables.
- [ ] Add one-time first-administrator bootstrap.
- [ ] Add admin-created users and expiring invitation links.
- [ ] Hash passwords using Argon2id with configurable secure defaults.
- [ ] Implement login, token refresh, logout, and session revocation.
- [ ] Implement password change and administrator password reset.
- [ ] Implement disabled-user behavior.
- [ ] Add login rate limiting and basic abuse protection.
- [ ] Add authenticated `/api/v1/auth`, `/api/v1/users`, and administration endpoints.
- [ ] Ensure client-supplied user IDs are never trusted for authorization.
- [ ] Add audit events for authentication and user-administration actions.
- [ ] Define native credential storage using the operating system credential store.
- [ ] Add a minimal native login and server-connection flow.

### Completion Gate

- [ ] A fresh deployment can bootstrap an administrator and create or invite users.
- [ ] Revoked, expired, disabled, and forged sessions cannot access protected endpoints.
- [ ] Authentication secrets do not appear in logs or application state persistence.
- [ ] Security-focused integration tests cover all authentication flows.

---

## Phase 3: Hosted Vault Storage and Permissions

**Objective:** Make the server authoritative for online hosted vaults before adding live co-editing or offline support.

**Estimated effort:** 5-8 weeks.

### Tasks

- [ ] Implement vault, membership, file-manifest, revision, blob, trash, snapshot, and activity tables.
- [ ] Implement server-side role enforcement for every vault operation.
- [ ] Implement hosted-vault create, list, rename, archive, and delete.
- [ ] Implement member invite, removal, and role updates.
- [ ] Implement file and folder listing using stable file IDs and relative paths.
- [ ] Implement text-document read and optimistic write operations.
- [ ] Implement binary-asset upload, download, deduplication, and integrity checks.
- [ ] Implement create, rename, move, trash, restore, and purge operations.
- [ ] Implement server-side path normalization and traversal protection.
- [ ] Implement reference-impact previews and reference rewrites.
- [ ] Implement snapshots, history listing, comparison inputs, and restore.
- [ ] Implement vault activity events.
- [ ] Implement hosted search and note indexing.
- [ ] Implement local-vault ZIP import into hosted storage.
- [ ] Implement hosted-vault export compatible with the existing local layout.
- [ ] Implement storage accounting.
- [ ] Add versioned `/api/v1/vaults` endpoints.

### Completion Gate

- [ ] Authenticated clients can fully manage an online hosted vault through the API.
- [ ] Viewers cannot mutate data through any REST endpoint.
- [ ] Editors and admins are limited according to documented role rules.
- [ ] Imports and exports round-trip into valid local vaults.
- [ ] All mutations produce consistent manifests, revisions, and audit/activity records.

---

## Phase 4: Native Hosted-Vault Client

**Objective:** Let the existing Tauri app use online hosted vaults while preserving local-vault workflows.

**Estimated effort:** 6-10 weeks.

### Tasks

- [ ] Add `local` and `hosted` vault kinds to shared vault metadata.
- [ ] Define a shared `VaultClient` interface for frontend vault operations.
- [ ] Implement `LocalVaultClient` over existing typed Tauri commands.
- [ ] Implement online-only `HostedVaultClient` over HTTP and authenticated asset URLs.
- [ ] Add runtime capability interfaces for native-only operations.
- [ ] Add server connection, login, logout, and hosted-vault picker UI.
- [ ] Refactor vault, file, search, history, templates, previews, and collaboration consumers to use the selected client.
- [ ] Add hosted asset upload/download flows.
- [ ] Add hosted-vault member-management UI.
- [ ] Add online connection and error states.
- [ ] Remove hosted-mode reliance on client-generated or client-reported user IDs.
- [ ] Preserve all local-vault features and storage formats.
- [ ] Add frontend adapter contract tests for local and hosted clients.

### Completion Gate

- [ ] The native app can create, open, edit, manage, export, and close hosted vaults while online.
- [ ] The same native build continues to operate existing local vaults without regression.
- [ ] Hosted operations are authorized by server sessions rather than local identity state.
- [ ] Local and hosted behavior differences are visible and intentional.

---

## Phase 5: Live Collaboration

**Objective:** Add true live co-editing and rich awareness for hosted text-backed documents.

**Estimated effort:** 6-10 weeks.

### Tasks

- [ ] Add `yrs` and define persisted CRDT document records and update logs.
- [ ] Implement authenticated `/ws/v1/vaults/{vaultId}` sessions.
- [ ] Reject unauthorized subscriptions and mutation messages.
- [ ] Implement note collaboration using shared text documents.
- [ ] Implement Kanban collaboration using shared maps and arrays.
- [ ] Implement canvas collaboration using shared maps and arrays.
- [ ] Implement ephemeral presence and rich awareness.
- [ ] Implement chat delivery through the server transport.
- [ ] Implement CRDT update persistence and periodic compaction.
- [ ] Materialize CRDT state into `.md`, `.kanban`, and `.canvas` export forms.
- [ ] Integrate native document views with live hosted sessions.
- [ ] Add reconnect behavior for brief connection interruptions.
- [ ] Add protocol version negotiation and unsupported-version errors.
- [ ] Add metrics for connections, rooms, update rates, and compaction.

### Completion Gate

- [ ] Multiple online clients can concurrently edit notes, Kanban boards, and canvases.
- [ ] Awareness is live-only and is not incorrectly persisted as document content.
- [ ] Reconnecting clients converge without losing acknowledged edits.
- [ ] Server restarts recover persisted collaborative document state.
- [ ] Exported document formats remain compatible with local vaults.

---

## Phase 6: Full Offline Synchronization

**Objective:** Allow native clients to continue editing hosted vaults offline and safely reconcile later.

**Estimated effort:** 8-14 weeks.

### Tasks

- [ ] Implement a managed native hosted-vault replica store.
- [ ] Persist manifests, CRDT state, cached assets, tombstones, and pending operations.
- [ ] Add explicit sync-state and pending-operation models.
- [ ] Implement reconnect synchronization using CRDT state vectors.
- [ ] Implement manifest delta synchronization.
- [ ] Implement offline create, edit, rename, move, trash, restore, and delete.
- [ ] Resolve structural operations using stable file IDs.
- [ ] Define and implement recovery for irreconcilable structural conflicts.
- [ ] Implement resumable and retryable binary uploads.
- [ ] Implement bounded cache and replica cleanup.
- [ ] Add sync-status, pending-change, conflict, and recovery UI.
- [ ] Handle revoked access and deleted/archived vaults while a replica is offline.
- [ ] Add corruption detection and replica rebuild.

### Completion Gate

- [ ] Two clients can edit the same hosted vault offline and later converge.
- [ ] Offline structural conflicts never silently discard user data.
- [ ] Interrupted asset uploads resume or fail with a recoverable state.
- [ ] Revoked clients cannot upload new operations after reconnecting.
- [ ] Replica corruption can be detected and repaired without affecting canonical server data.

---

## Phase 7: Production Hardening

**Objective:** Make the self-hosted server operable, recoverable, observable, and upgradeable.

**Estimated effort:** 4-8 weeks, followed by ongoing maintenance.

### Tasks

- [ ] Add automated PostgreSQL and blob-storage backups.
- [ ] Add documented full and per-vault restore procedures.
- [ ] Add backup verification and restore tests.
- [ ] Add metrics, dashboards, health alerts, and structured audit logs.
- [ ] Add storage quotas and configurable upload limits.
- [ ] Add REST and WebSocket rate limits.
- [ ] Add retention and compaction policies.
- [ ] Add migration rollback and failed-upgrade recovery procedures.
- [ ] Add graceful maintenance mode.
- [ ] Add security headers, TLS deployment guidance, and secret-rotation procedures.
- [ ] Add dependency and container vulnerability scanning.
- [ ] Add multi-architecture container builds.
- [ ] Add GitHub Actions image publishing and release versioning.
- [ ] Document supported deployment topology and upgrade compatibility.
- [ ] Run a security review and load test.

### Completion Gate

- [ ] A documented backup can restore a deployment into a clean environment.
- [ ] Operators can identify unhealthy services, failed sync, and storage pressure.
- [ ] Upgrades preserve data and provide a documented recovery path.
- [ ] Published images are versioned, reproducible, and vulnerability-scanned.
- [ ] Security review findings required for release are resolved.

---

## Cross-Phase Verification

Run the checks relevant to every changed subsystem before marking tasks complete:

```bash
pnpm test
pnpm exec tsc --noEmit
cd src-tauri && cargo test
cd src-tauri && cargo check
docker compose config
docker compose up
```

Add server-specific unit, integration, protocol, and Compose smoke-test commands once the server workspace exists.

Required recurring scenarios:

- Authentication, expiration, revocation, and disabled-user behavior.
- Forged identities and unauthorized REST/WebSocket operations.
- Viewer, editor, admin, and owner permission boundaries.
- Simultaneous note, Kanban, and canvas editing.
- Server restart and collaborative-state recovery.
- Multiple offline clients reconnecting with overlapping changes.
- Rename, move, delete, restore, and reference-rewrite conflicts.
- Interrupted and resumed binary uploads.
- Hosted export reopened as a valid local vault.
- Complete Compose deployment backup and restore.

## Progress Log

Add one entry whenever a meaningful server milestone lands.

| Date | Phase | Change | Verification | Remaining Follow-up |
| --- | --- | --- | --- | --- |
| 2026-06-09 | Planning | Created phased implementation tracker | Repository architecture reviewed | Begin Phase 0 decisions and contracts |
| 2026-06-09 | Phase 0 | Accepted authentication, storage, CRDT, offline-sync, domain, protocol, security, migration, workspace, and verification decisions | Checked contracts against current Rust/TypeScript models and local vault behavior | Begin Phase 1 workspace and server foundation |
