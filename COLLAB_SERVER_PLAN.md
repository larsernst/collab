# Collaboration Server Implementation Tracker

## Goal

Build a self-hosted collaboration server distributed through Docker Compose.

The server will become authoritative for hosted vaults, authenticated users, permissions, live collaboration, history, and synchronization. The native Tauri app will gain a hosted-vault mode while retaining its existing local-vault mode.

This document is the source of truth for implementation progress. Update task checkboxes and the status table whenever server work lands.

## Status Summary

| Phase | Status | Completion |
| --- | --- | --- |
| 0. Architecture and prerequisites | Complete | 100% |
| 1. Server foundation and Compose | Complete | 100% |
| 2. Authentication and administration | Complete | 100% |
| 3. Hosted vault storage and permissions | Complete | 100% |
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

- [x] Standalone collaboration server process.
- [x] Docker Compose server deployment.
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
- The server includes a focused Collab-style admin web interface; it is separate from any future general-purpose vault web app.
- GitHub-built container images and a possible general-purpose vault web app are outside the initial server implementation.

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

- [x] Convert the Rust backend into a workspace without breaking Tauri builds.
- [x] Add a reusable `collab-core` crate for shared vault rules and models.
- [x] Add a standalone `collab-server` Rust binary.
- [x] Add structured configuration from environment variables and config files.
- [x] Add structured logging and request correlation IDs.
- [x] Add liveness and readiness endpoints.
- [x] Add PostgreSQL connection management and migrations.
- [x] Add persistent local blob storage behind a storage trait.
- [x] Add a development `compose.yaml` with:
  - `collab-server`
  - `postgres`
  - `gateway`
  - Persistent data and backup volumes
- [x] Add Caddy routing and local TLS/development HTTP configuration.
- [x] Add graceful startup, shutdown, and migration behavior.
- [x] Add server integration-test infrastructure.
- [x] Document local server development and Compose operation.

### Completion Gate

- [x] `docker compose up` starts a healthy server and PostgreSQL from a clean checkout.
- [x] Database migrations run safely and idempotently.
- [x] Server data survives container recreation.
- [x] Tauri local-vault behavior and existing tests remain green.

---

## Phase 2: Authentication and Administration

**Objective:** Establish trustworthy server identities and a secure web administration
surface before hosted vault mutations are exposed.

**Estimated effort:** 4-7 weeks.

### Tasks

- [x] Implement the user, credential, session, invitation, and audit-event tables.
- [x] Add one-time first-administrator bootstrap.
- [x] Add admin-created users and expiring invitation links.
- [x] Hash passwords using Argon2id with configurable secure defaults.
- [x] Implement login, token refresh, logout, and session revocation.
- [x] Implement password change and administrator password reset.
- [x] Implement disabled-user behavior.
- [x] Add login rate limiting and basic abuse protection.
- [x] Add authenticated `/api/v1/auth`, `/api/v1/users`, and administration endpoints.
- [x] Ensure client-supplied user IDs are never trusted for authorization.
- [x] Add audit events for authentication and user-administration actions.
- [x] Add a server-hosted admin web interface using the Collab visual language.
- [x] Add secure browser authentication for the admin interface using hardened HTTP-only cookies and CSRF protection.
- [x] Add an admin dashboard with:
  - Server health, version, uptime, and storage summary.
  - User, active-session, invitation, and hosted-vault counts.
  - Recent redacted audit events and operational warnings.
  - Read-only hosted-vault inventory ready for Phase 3 management actions.
- [x] Add web user-management flows for create, invite, disable, reset password, revoke sessions, and inspect user activity.
- [x] Add authenticated administration summary and audit-event endpoints.
- [x] Add frontend tests, accessibility checks, and browser-level admin-flow tests.
- [x] Define native credential storage using the operating system credential store.
- [x] Add a minimal native login and server-connection flow.

### Completion Gate

- [x] A fresh deployment can bootstrap an administrator and create or invite users.
- [x] Revoked, expired, disabled, and forged sessions cannot access protected endpoints.
- [x] Authentication secrets do not appear in logs or application state persistence.
- [x] Security-focused integration tests cover all authentication flows.
- [x] An administrator can securely bootstrap and manage users through the web interface.
- [x] The dashboard exposes useful health, audit, and vault summaries without exposing raw secrets or unrestricted server logs.
- [x] Non-admin users cannot access admin pages or administration APIs.

---

## Phase 3: Hosted Vault Storage and Permissions

**Objective:** Make the server authoritative for online hosted vaults before adding live co-editing or offline support.

**Estimated effort:** 5-8 weeks.

### Tasks

- [x] Implement vault, membership, file-manifest, revision, blob, trash, snapshot, and activity tables.
- [x] Implement server-side role enforcement for every vault operation.
- [x] Implement hosted-vault create, list, rename, archive, and delete.
- [x] Implement member invite, removal, and role updates.
- [x] Implement file and folder listing using stable file IDs and relative paths.
- [x] Implement text-document read and optimistic write operations.
- [x] Implement binary-asset upload, download, deduplication, and integrity checks.
- [x] Implement create, rename, move, trash, restore, and purge operations.
- [x] Implement server-side path normalization and traversal protection.
- [x] Implement reference-impact previews and reference rewrites.
- [x] Implement snapshots, history listing, comparison inputs, and restore.
- [x] Implement vault activity events.
- [x] Expand the admin web interface from read-only vault inventory to vault details, member management, archive/delete controls, storage usage, and activity views.
- [x] Implement hosted search and note indexing.
- [x] Implement local-vault ZIP import into hosted storage.
- [x] Implement hosted-vault export compatible with the existing local layout.
- [x] Implement storage accounting.
- [x] Add versioned `/api/v1/vaults` endpoints.

### Completion Gate

- [x] Authenticated clients can fully manage an online hosted vault through the API.
- [x] Viewers cannot mutate data through any REST endpoint.
- [x] Editors and admins are limited according to documented role rules.
- [x] Imports and exports round-trip into valid local vaults.
- [x] All mutations produce consistent manifests, revisions, and audit/activity records.

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
docker compose up --build --wait
./scripts/server-smoke.sh
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
| 2026-06-09 | Phase 1 | Added the Rust workspace, shared core/protocol crates, standalone server, PostgreSQL migrations, blob storage, cached server image, Compose stack, Caddy gateway, health checks, and development docs | `cargo test --workspace` (114 tests), live PostgreSQL migration test, `cargo check --workspace`, `pnpm test` (594 tests), TypeScript check, Compose health/persistence recreation checks, and `./scripts/server-smoke.sh` | Begin Phase 2 authentication and administration |
| 2026-06-09 | Phase 2 planning | Added a server-hosted Collab-style admin web interface for user management, health, audit data, and phased vault administration | Reviewed authentication, authorization, logging, and Phase 3 API boundaries | Implement authentication and the admin web foundation together |
| 2026-06-09 | Phase 2 | Implemented the first secure administration slice: identity/session/audit schema, Argon2id credentials, one-time bootstrap, browser login/logout, CSRF, login rate limiting, disabled-user/session revocation behavior, admin APIs, and a server-hosted Collab-style dashboard | Focused Rust and admin-web tests, live PostgreSQL bootstrap/login/admin/CSRF/revocation lifecycle, production admin build, Compose image build, and live Caddy API flow | Add invitations, rotating native refresh tokens, password self-service, operational/storage summaries, browser automation/accessibility coverage, and native login |
| 2026-06-09 | Phase 2 complete | Added expiring one-time invitations, dedicated password change/reset flows, opaque native access tokens with rotating refresh-token reuse detection, OS credential-store-backed desktop login, storage and operational dashboard summaries, read-only vault inventory, user activity inspection, and complete admin management flows | Security-focused live PostgreSQL lifecycle tests, Rust workspace checks, admin/browser-flow and accessibility-oriented tests, TypeScript checks, production admin build, and Compose configuration validation; final image rebuild was blocked by a crates.io network failure | Begin Phase 3 hosted vault storage and permissions |
| 2026-06-09 | Phase 2 account lifecycle | Added account re-enable and permanent deletion controls, with durable primary-administrator identification and server-side protection from disable/delete operations | Admin-web management-flow tests, Rust checks, and live PostgreSQL lifecycle tests | Begin Phase 3 hosted vault storage and permissions |
| 2026-06-10 | Phase 3 foundation | Added canonical hosted-vault, membership, file/revision/blob/trash/snapshot/operation/activity tables; authenticated vault lifecycle and membership APIs; owner/admin role enforcement; real admin inventory/counts; and vault activity records | Rust checks, admin production build, migration idempotency, and live PostgreSQL lifecycle coverage for membership visibility, viewer denial, owner protection, archive enforcement, activity, and pending deletion | Implement stable-ID file manifests and text-document revision operations |
| 2026-06-10 | Phase 3 files and text revisions | Added strict portable hosted-path normalization, stable-ID file manifests with derived relative paths, folder and text-document creation, current-document reads, optimistic revision writes/history, content-addressed text blobs, manifest sequencing, and same-vault relational constraints | Shared path tests, Rust checks, and live PostgreSQL lifecycle coverage for viewer denial, path rejection/collision, document reads, stale-write conflicts, revision history, manifest increments, activity, and archive enforcement | Implement binary upload/download and structural rename/move/trash/restore/purge operations |
| 2026-06-10 | Phase 3 assets and structural operations | Added bounded integrity-checked binary uploads, authenticated raw downloads, blob deduplication, idempotent stable-ID rename/move/trash/restore/purge operations, manifest conflict detection, and admin-only purge | Rust checks and live PostgreSQL lifecycle coverage for hash rejection, asset deduplication/download, idempotency, stale-manifest conflicts, stable-ID moves, trash/restore, and purge authorization | Implement snapshots/history restore and reference-impact previews/rewrites |
| 2026-06-10 | Phase 3 snapshots and history restore | Added labeled snapshots over immutable revisions, viewer-readable snapshot/history lists and historical text comparison inputs, and optimistic snapshot restore as a new revision | Rust checks and live PostgreSQL lifecycle coverage for historical reads, snapshot creation/listing, viewer mutation denial, stale restore rejection, restored content, and revision/manifest sequencing | Implement reference-impact previews and reference rewrites |
| 2026-06-10 | Admin web visual refresh | Reworked the administration interface around shadcn-style primitives and shared Collab tokens; added persisted dark, midnight, warm, and light themes, accent selection, and compact density settings | Admin component tests, settings persistence coverage, TypeScript checks, and production admin build | Continue Phase 3 server and administration features |
| 2026-06-10 | Phase 3 reference previews and rewrites | Moved note/kanban/canvas reference analysis and rewriting into shared `collab_core::references` (Tauri backend now delegates to it), added viewer-readable hosted file-reference listings, non-mutating role-checked structural-operation previews with blocked reasons and impact lists, and transactional reference rewrites with new revisions and activity on rename/move plus opt-in removal on trash | `cargo test --workspace` (133 tests) including the live PostgreSQL lifecycle with reference listing, preview, rewrite, replay, and viewer-denial coverage; `cargo check --workspace` | Expand the admin web vault management views and implement hosted search and note indexing |
| 2026-06-10 | Phase 3 admin vault management | Added operator-authority `/api/v1/admin/vaults/{vaultId}` detail, lifecycle (archive/reactivate/restore/pending-delete), owner-protected member management, and activity endpoints with audit plus `byServerAdmin` activity records, and expanded the admin web vault inventory into a full detail view with storage usage, member role controls, lifecycle actions, and activity | Live PostgreSQL lifecycle coverage for admin detail/lifecycle/member/activity flows incl. non-admin denial and pending-delete guards; admin-web component tests (14), TypeScript check, production admin build, `cargo test --workspace` | Implement hosted search and note indexing |
| 2026-06-10 | Phase 3 hosted search | Added a persistent PostgreSQL full-text note index with title/frontmatter-tag extraction, ranked viewer-readable vault search, Unicode-safe excerpts, and lazy repair/removal of missing or stale index rows from current hosted note revisions | Index metadata/excerpt unit coverage, live PostgreSQL lifecycle search and stale-revision repair coverage, migration idempotency, Rust workspace checks, and Compose smoke verification | Implement local-vault ZIP import and hosted-vault export |
| 2026-06-10 | Phase 3 ZIP import and export | Added admin-only bounded ZIP import for empty hosted vaults with portable-path, traversal, symlink, duplicate, entry-count, expanded-size, and UTF-8 validation; added active-current-content ZIP export compatible with the normal local vault layout | Archive parser tests plus live PostgreSQL lifecycle coverage for authorization, import, hosted search after import, export, and content round-trip; Rust workspace checks and Compose smoke verification | Implement storage accounting and close remaining Phase 3 authorization/versioning gates |
| 2026-06-10 | Phase 3 complete | Added viewer-readable per-vault logical storage accounting, audited every versioned hosted-vault route, and added explicit viewer/editor server-side authorization matrix coverage across all mutation families and elevated admin/owner operations | Live PostgreSQL authorization/storage lifecycle coverage plus Rust workspace checks | Begin Phase 4 native hosted-vault client |
