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
| 4. Native hosted-vault client | In progress | 60% |
| 5. Live collaboration | Complete | 100% |
| 6. Full offline synchronization | Complete | 100% |
| 7. Production hardening | In progress | 27% |

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
- [x] Server-authenticated users and sessions.
- [X] Server-enforced hosted-vault permissions.
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

- [x] Add `local` and `hosted` vault kinds to shared vault metadata.
- [x] Define a shared `VaultClient` interface for frontend vault operations.
- [x] Implement `LocalVaultClient` over existing typed Tauri commands.
- [x] Retire the proof-of-concept local permission system:
  - Local vault operations do not use owner/admin/editor/viewer authorization.
  - Existing local membership metadata remains readable for compatibility but is ignored for authorization.
  - Permission and member-management settings are hidden for local vaults.
  - Local collaboration identity metadata remains available for presence, chat authorship, and activity labels.
- [x] Implement online-only `HostedVaultClient` over HTTP and authenticated asset URLs.
- [x] Add runtime capability interfaces for native-only operations.
- [x] Add server connection, login, logout, and hosted-vault picker UI.
- [x] Refactor vault, file, search, history, templates, previews, and collaboration consumers to use the selected client.
- [x] Add hosted asset upload/download flows.
- [x] Add hosted-vault member-management UI.
- [x] Add online connection and error states.
- [x] Remove hosted-mode reliance on client-generated or client-reported user IDs.
- [x] Preserve all local-vault features and storage formats.
- [x] Add frontend adapter contract tests for local and hosted clients.

### Completion Gate

- [x] The native app can create, open, edit, manage, export, and close hosted vaults while online.
  - Create (`POST /api/v1/vaults`, creator becomes vault admin/owner), open, edit,
    manage (members/roles), export (admin-only ZIP download), and close are all
    available natively from the vault picker and Vault Manager.
- [x] The same native build continues to operate existing local vaults without regression.
- [x] Hosted operations are authorized by server sessions rather than local identity state.
- [x] Local and hosted behavior differences are visible and intentional.

---

## Phase 4 Cleanup: Bugs To Fix And Small Additions Before Moving On

**Objective:** Bugs that now exist need to be fixed before moving to the next phase.

### Tasks

- [x] Update github workflow to use the new paths
- [x] Auto Login error even when the user was never connected to a server
- [x] `Create Hosted Vault` button still appears / works even when not connected to a server
- [x] Auto Login error pops up twice
- [x] Save username when login gets disrupted
- [x] People with the "viewer" permission get a "could not save" error when attempting to write into a note. -> maybe disable editing all together for them / implement a read-only-mode
- [x] Need login / logout controls in the startup dialog
- [x] Need a way to add documents, images, notes to the hosted vault
- [x] Add drag and drop to add files into the Vault (limited to images, pdfs and markdown files)
- [x] Deprecate AppImage Workflow -> This is not really used anymore and basically replaced by Flatpak
- [x] Take better action on slower connections (slow internet / self-hosted VPN home servers): quick successive edits could fail with "could not save because the file revision changed in the meantime"

---

## Phase 5: Live Collaboration

**Objective:** Add true live co-editing and rich awareness for hosted text-backed documents.

**Estimated effort:** 6-10 weeks.

### Tasks

- [x] Add `yrs` and define persisted CRDT document records and update logs.
- [x] Implement authenticated `/ws/v1/vaults/{vaultId}` sessions.
- [x] Reject unauthorized subscriptions and mutation messages.
- [x] Implement note collaboration using shared text documents.
- [x] Implement Kanban collaboration using shared maps and arrays.
- [x] Implement canvas collaboration using shared maps and arrays.
- [x] Implement ephemeral presence and rich awareness.
- [x] Implement chat delivery through the server transport.
- [x] Implement CRDT update persistence and periodic compaction.
- [x] Materialize CRDT state into `.md`, `.kanban`, and `.canvas` export forms.
- [x] Integrate native document views with live hosted sessions.
- [x] Add reconnect behavior for brief connection interruptions.
- [x] Add protocol version negotiation and unsupported-version errors.
- [x] Add metrics for connections, rooms, update rates, and compaction (exposure in web ui).
- [x] Add chat log view to the admin web ui
- [x] Add web ui auto refresh for changes.

### Completion Gate

- [x] Multiple online clients can concurrently edit notes, Kanban boards, and canvases.
- [x] Awareness is live-only and is not incorrectly persisted as document content.
- [x] Reconnecting clients converge without losing acknowledged edits.
- [x] Server restarts recover persisted collaborative document state.
- [x] Exported document formats remain compatible with local vaults.

---

## Phase 6: Full Offline Synchronization

**Objective:** Allow native clients to continue editing hosted vaults offline and safely reconcile later.

**Estimated effort:** 8-14 weeks.

### Tasks

- [x] Implement a managed native hosted-vault replica store.
- [x] Persist manifests, CRDT state, cached assets, tombstones, and pending operations.
- [x] Add explicit sync-state and pending-operation models.
- [x] Implement reconnect synchronization using CRDT state vectors. (Notes and structured Kanban/canvas documents.)
- [x] Implement manifest delta synchronization.
- [x] Implement offline create, edit, rename, move, trash, restore, and delete.
- [x] Resolve structural operations using stable file IDs.
- [x] Define and implement recovery for irreconcilable structural conflicts.
- [x] Implement resumable and retryable binary uploads.
- [x] Implement bounded cache and replica cleanup.
- [x] Add sync-status, pending-change, conflict, and recovery UI.
- [x] Handle revoked access and deleted/archived vaults while a replica is offline.
- [x] Add corruption detection and replica rebuild.

### Completion Gate

- [x] Two clients can edit the same hosted vault offline and later converge.
- [x] Offline structural conflicts never silently discard user data.
- [x] Interrupted asset uploads resume or fail with a recoverable state.
- [x] Revoked clients cannot upload new operations after reconnecting.
- [x] Replica corruption can be detected and repaired without affecting canonical server data.

---

## Phase 7: Production Hardening

**Objective:** Make the self-hosted server operable, recoverable, observable, and upgradeable.

**Estimated effort:** 4-8 weeks, followed by ongoing maintenance.

### Tasks

- [x] Add automated PostgreSQL and blob-storage backups.
- [x] Add documented full and per-vault restore procedures.
- [x] Add backup verification and restore tests.
- [x] Add UI integration for running, managing and restoring backups
- [x] Add metrics, dashboards, health alerts, and structured audit logs.
- [x] Add storage quotas and configurable upload limits.
- [x] Add REST and WebSocket rate limits.
- [x] Add retention and compaction policies.
- [x] Add migration rollback and failed-upgrade recovery procedures.
- [x] Add graceful maintenance mode.
- [ ] Add security headers, TLS deployment guidance, and secret-rotation procedures.
- [ ] Add dependency and container vulnerability scanning.
- [ ] Add multi-architecture container builds.
- [ ] Add GitHub Actions image publishing and release versioning.
- [ ] Document supported deployment topology and upgrade compatibility.
- [ ] Run a security review and load test.

### Completion Gate

- [x] A documented backup can restore a deployment into a clean environment.
- [x] Operators can identify unhealthy services, failed sync, and storage pressure.
- [x] Upgrades preserve data and provide a documented recovery path.
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
| 2026-06-10 | Phase 3 deployment and admin UX follow-up | Published the Compose gateway on a configurable host interface, redirected the main port root to `/admin/`, and added vault storage accounting plus ZIP import/export controls to the administration vault detail view | Admin web tests/build, root redirect server test, Compose configuration, and Compose smoke verification | Begin Phase 4 native hosted-vault client |
| 2026-06-10 | Phase 3 import body-limit fix | Derived the Axum JSON request-body limit from configured upload/import limits plus base64/envelope overhead so valid ZIP imports and asset uploads above the framework's 2 MiB default no longer fail as gateway broken pipes; separated defaults into 256 MiB per-file, 512 MiB compressed-import, and 2 GiB expanded-import limits | Server regression coverage above the old default limit plus Compose gateway verification | Begin Phase 4 native hosted-vault client |
| 2026-06-10 | Phase 3 server-admin hierarchy and file browser | Elevated active server administrators above vault owner/admin roles through implicit content access without membership or ownership, added restore-as-new-revision, and expanded the admin vault view with file metadata, downloads, moves, history, and revision restore | Live PostgreSQL operator-access coverage, admin web interaction tests/build, Rust workspace checks, and Compose smoke verification | Begin Phase 4 native hosted-vault client |
| 2026-06-11 | Phase 4 client boundary | Added backward-compatible local/hosted vault metadata across TypeScript and Tauri IPC, defined a capability-aware `VaultClient` contract with opaque document versions, and implemented the tested `LocalVaultClient` adapter over existing typed Tauri commands | Full frontend suite (617 tests), TypeScript check, Tauri metadata compatibility test, Rust workspace checks | Implement the online-only `HostedVaultClient` and native hosted-vault listing/opening flow |
| 2026-06-11 | Phase 4 permission-model planning | Added an early Phase 4 task to retire local role authorization while preserving identity metadata, and reserved permission/member-management UI for server-authoritative hosted vaults | Reviewed local filesystem trust limits and the hosted permission boundary | Remove local permission enforcement before connecting hosted member management |
| 2026-06-11 | Phase 4 local permission retirement | Removed local ownership claiming, member-role commands, and local role state; new local vaults retain identity metadata without creating owner/admin records; Vault Manager now shows permissions only for hosted vaults and local encryption only for local vaults | Focused frontend permission-boundary and identity registration tests, Rust vault creation tests, TypeScript and workspace checks | Implement the online-only `HostedVaultClient` and native hosted-vault listing/opening flow |
| 2026-06-11 | Phase 4 hosted client adapter | Added the online-only `HostedVaultClient` for hosted file trees, text revisions, creation, manifest-locked structural operations, trash, search, snapshots, and authenticated asset reads; added a vault-API-limited Rust request gateway that keeps access tokens memory-only and rejects requests for a different connected server | Full frontend suite, hosted adapter contract tests, Rust hosted-request boundary tests, TypeScript and Rust checks | Add runtime capability interfaces for native-only operations, then connect hosted-vault listing/opening UI |
| 2026-06-11 | Phase 4 runtime capability boundary | Added callable runtime capability interfaces for filesystem watching, local encryption, external asset import, local archive export, and authenticated hosted assets; added the local/hosted client factory and migrated vault-store file loading, watcher lifecycle, unlock behavior, and Vault Manager encryption/export controls to capability checks | Frontend adapter/store capability tests, full frontend suite, TypeScript check, and Rust workspace verification | Add server connection, hosted-vault listing, and hosted-vault opening UI |
| 2026-06-11 | Phase 4 hosted-vault picker | Centralized native server session and hosted-vault inventory state, connected Settings login/logout to the shared store, and added hosted-vault listing/opening to the initial vault picker without treating hosted IDs as local filesystem paths | Server-store, picker, settings, and vault-store regression coverage plus TypeScript and workspace verification | Refactor remaining vault, file, search, history, templates, previews, and collaboration consumers to use the selected client |
| 2026-06-11 | Phase 4 vault-management client migration | Expanded `VaultClient` with permanent deletion, references, trash restore/purge, and snapshot restore/history operations; migrated the file tree, board lists, trash panel, sidebar and command-bar search, and history views to the selected local/hosted client; hosted snapshot deletion remains intentionally unavailable because server snapshots are immutable | Local/hosted adapter contract coverage plus file-tree, trash, history, frontend, TypeScript, and workspace verification | Migrate document editors/sessions, templates, previews, and remaining collaboration consumers to the selected client |
| 2026-06-11 | Phase 4 private-server TLS support | Kept native TLS verification enabled by default, added an explicit per-session opt-in for private/self-signed certificates across login, reconnect, hosted API, asset download, and logout requests, and replaced the generic connection failure with actionable TLS/network diagnostics | Native server-command tests, settings interaction coverage, frontend suite, TypeScript, and Rust workspace verification | Continue migrating document sessions and remaining hosted-vault consumers |
| 2026-06-11 | Phase 4 hosted-note snippet regression | Made hosted note opening independent from local vault-snippet storage, selected app-only snippet scope before native filesystem resolution, and tolerated the legacy missing-vault-path response without an unhandled promise rejection | Hosted markdown note regression test, note-snippet store tests, native snippet-scope test, frontend suite, TypeScript, and Rust workspace verification | Continue hosted note/editor validation |
| 2026-06-11 | Phase 4 document-session client migration | Added `createSnapshot` to the `VaultClient` contract (local writes caller content; hosted labels the current immutable revision from the session identity) and migrated the note, Kanban, and canvas document editor sessions to load, write, snapshot, and auto-rename through the selected client; native-only filesystem-watch reload is now gated behind the `filesystemWatch` capability and note editors fall back to app-scoped snippets for hosted vaults | Full frontend suite (641 tests), local/hosted `createSnapshot` contract coverage, updated note/Kanban/canvas session tests, and TypeScript check | Migrate templates, previews, and remaining collaboration consumers (image/PDF media views stay coarse-presence only) |
| 2026-06-11 | Phase 4 consumer refactor complete | Finished the consumer refactor: promoted asset reads to a universal `VaultClient.readAssetDataUrl` (replacing the unused hosted-only `authenticatedAssets` runtime capability), routed every preview/media asset read (markdown/live-preview images, file-tree and PDF-link hover previews, canvas previews, PDF/image viewers), text reads/writes (tag patching, conflict resolution, kanban template-from-board, note print export, PDF quote-to-note/canvas), and command-bar document creation through the selected client, and consolidated all snapshot operations onto the client by removing the now-dead snapshot methods from the collab transport | Full frontend suite (642 tests), rewritten `pdfPreview` local-cache/hosted-render coverage, updated `vaultClient`/`CollabProvider` tests, TypeScript check, and a repo-wide sweep confirming no non-adapter consumer still calls document/asset IPC directly | Add hosted asset upload/download flows and hosted member-management UI |
| 2026-06-11 | Phase 4 hosted asset upload + member management | Added hosted asset upload: a native `readFileForUpload` command (digest-verified base64 payload), an `externalAssetImport` runtime capability for hosted vaults (file drag-drop and clipboard data-URL paste, with auto-`Pictures` folder creation and server-verified SHA-256), and refactored the editor drop/paste integration to drive both local and hosted through the capability (download already existed via `readAssetDataUrl`). Added hosted member management: a read-only authenticated `/api/v1/users/directory` server endpoint + dedicated `hostedUserDirectory` native command (keeping the generic vault gateway strict), a hosted-only `members` runtime capability (list/searchDirectory/add/updateRole/remove), and a searchable `HostedMembersPanel` in the Vault Manager permissions tab with owner protection and admin-gated controls | Full frontend suite (648 tests) incl. new `HostedMembersPanel` and `vaultClient` upload/member coverage, updated editor-integration tests, TypeScript check, `cargo check --workspace`, `cargo check --tests -p collab-server`, and the directory assertion added to the live-PG admin lifecycle test | Add online connection/error states, remove hosted reliance on client-reported user IDs, and add adapter contract tests |
| 2026-06-11 | Phase 4 identity authority + connection states | Added a server-authoritative effective-identity abstraction (`useCollabIdentity` / `serverIdentityForVault` in `src/lib/collabIdentity.ts`, color helper extracted to `src/lib/userColor.ts` to break the store cycle): hosted vaults now resolve collaboration identity from the authenticated server session matched to the vault's server URL, while local vaults keep the client-generated identity; wired it into snapshot authorship for note/Kanban/canvas sessions and made the Settings profile read-only for hosted vaults. Added online connection/error states while a hosted vault is open: an `isServerSessionExpired` helper and a `HostedConnectionStatus` status-bar indicator showing Online/Session expired/Offline with an inline refresh-token reconnect. Added VaultClient adapter contract-parity tests asserting both adapters implement the full method surface, capability matrix, and mutually exclusive native vs hosted runtime capabilities | Full frontend suite (673 tests) incl. new `collabIdentity`, `HostedConnectionStatus`, `isServerSessionExpired`, and adapter-parity coverage; TypeScript check | Native hosted-vault creation and ZIP export remain server-administration operations (only outstanding completion-gate item); begin Phase 5 live collaboration |
| 2026-06-11 | Phase 4 hosted vaults in vault manager | Surfaced connected-server hosted vaults (membership-scoped `GET /api/v1/vaults`) in the `VaultManagerModal` Vaults tab alongside local recents, not only in the initial `VaultPicker`: added a `HostedVaultRow`, a refreshable "Hosted · <server>" section gated on an active server session, and a server-backed open handler routing through `openHostedVault`; the local list is now explicitly filtered to local-kind vaults | Full frontend suite (676 tests) incl. new `VaultManagerModal` hosted-listing/open/disconnected coverage; TypeScript check | Native hosted-vault creation and ZIP export |
| 2026-06-11 | Phase 4 native hosted create + export (gate closed) | Added native hosted-vault creation (`serverStore.createHostedVault` → `POST /api/v1/vaults`; the creator becomes vault admin/owner) with an inline "New hosted vault" form in both the `VaultPicker` and `VaultManagerModal`, opening the created vault on success. Added native hosted-vault ZIP export: a new binary-streaming `hosted_vault_export_zip` Tauri command (bearer stays in Rust, writes the downloaded archive to a chosen path) exposed through an admin-only hosted `archiveExport` runtime capability and an export action on admin hosted rows, reusing the existing mode-agnostic export handler. Closes the last Phase 4 completion-gate item (native create/open/edit/manage/export/close hosted vaults while online) | Full frontend suite (681 tests) incl. hosted create (store + picker + manager) and admin-gated export-capability coverage; TypeScript check; `cargo check` | Phase 4 complete — begin Phase 5 live collaboration |
| 2026-06-11 | Phase 4 hosted-open crash fix + auto-reconnect | Fixed a hosted-vault open crash where `AppShell` built the note index with the raw `hosted://` path via the local filesystem command; added a `buildNoteIndex` method to the `VaultClient` contract (local builds the full content index on disk, hosted derives a lightweight path/title index from the manifest) and routed both `AppShell` index builds through the selected client. Added automatic startup session restore: `serverStore.restoreSession` reuses a live in-memory session or reconnects from the OS-stored refresh token, invoked once on app launch; a failed restore surfaces a toast directing the user to reconnect from Settings | Full frontend suite (686 tests) incl. `restoreSession` (skip/reuse/reconnect/fail) and hosted `buildNoteIndex` coverage; TypeScript check | Hosted kanban filter/automation presets, image overlays, and chat still call local-filesystem commands and remain hosted follow-ups; begin Phase 5 live collaboration |
| 2026-06-11 | Phase 4 remaining hosted filesystem guards | Closed the remaining hosted-incompatible local-filesystem paths by gating them on the `nativeFilesystem` capability: PDF workspace sidecars (`PdfView`) and image additive-overlay sidecars + edited-image saves (`useImageDocumentSession`) are now in-memory/disabled for hosted; kanban filter/automation presets (`KanbanBoard`) and note snippets (`NoteSnippetsDialog`) fall back to app scope via a null vault path with vault-scope options hidden; the kanban templates feature (`BoardsPanel`/`KanbanTemplatesModal`) is hidden for hosted; and `ChatPanel` shows an explicit "not available for hosted vaults yet" state instead of silently failing sends. Hosted vaults can create blank kanban/canvas boards through the client | Full frontend suite (688 tests) incl. new `ChatPanel` hosted-availability coverage; TypeScript check | Begin Phase 4 Bugfix Phase |
| 2026-06-12 | Phase 4 bugfix: spurious auto-login error | Fixed the startup auto-reconnect surfacing a "could not restore your hosted server session" error when no credential exists (e.g. a saved server URL left over after a disconnect, or a URL never successfully authenticated). Added a `server_has_saved_session` Tauri command + `serverHasSavedSession` wrapper that checks the OS credential store, and `restoreSession` now returns `'skipped'` (no toast) when no refresh token is stored, reserving `'failed'` for genuine reconnect failures with a real stored credential | `pnpm test serverStore` (13 tests, incl. new no-credential skip + credential-present failure cases), TypeScript check, `cargo check` | Continue Phase 4 bugfix tasks (hosted create button when disconnected, duplicate error toast, save username on disrupted login, viewer read-only mode, startup login/logout controls, hosted file add + drag-drop) |
| 2026-06-12 | Phase 4 bugfix: hosted-session lifecycle trio | Fixed three connection-lifecycle bugs: (1) the "New hosted vault" create button stayed visible/clickable when the access token had expired (native `server_connection_status` reports `connected` purely on session presence) — added an exported `isEffectivelyConnected` helper (connected + known URL + not expired) gating the create affordance in `VaultPicker`/`VaultManagerModal` and the `createHostedVault` store guard; (2) the startup auto-login failure toast fired twice under React StrictMode — `restoreSession` now deduplicates concurrent calls behind a single in-flight promise (`_restoreSessionOnce`); (3) the Settings login username was lost on a disrupted/failed login — made it a controlled input persisted to `collab-hosted-username` and saved up-front alongside the server URL so it survives and prefills | Full frontend suite (697 tests) incl. new `isEffectivelyConnected`, expired-create-guard, and restore-dedup coverage; updated `VaultPicker`/`serverStore` fixtures to non-expired tokens; TypeScript check | Continue Phase 4 bugfix tasks (viewer read-only mode, startup login/logout controls, hosted file add + drag-drop) |
| 2026-06-12 | Phase 4 bugfix: viewer read-only mode | Viewers on a hosted vault got a "could not save" error when editing because the document editors always attempted writes. Added a shared `isVaultReadOnly(vault)` helper (`true` only for a hosted `viewer`) and a reusable `ReadOnlyBanner`, then made all three editable document types genuinely read-only: notes set CodeMirror `EditorState.readOnly`/`editable.of(false)`, hide the editor toolbar behind the banner, and block autosave/manual-save/tag-transforms/image-drop; Kanban no-ops `updateBoard`, skips the empty-board default write, disables drag and hides add-card/add-column; canvas blocks the session save + blank/repair writes, sets ReactFlow `nodesDraggable/elementsSelectable/nodesConnectable/edgesReconnectable`/delete off, hides the node-adding toolbar group, and disables canvas drop/insert. No write is ever attempted in read-only mode, so the server-rejected save error can no longer occur | Full frontend suite (702 tests) incl. new `isVaultReadOnly` unit, `markdownEditorViewConfig` read-only state, and NoteView + KanbanPage hosted-viewer no-write coverage; TypeScript check; `cargo check` | Continue Phase 4 bugfix tasks (startup login/logout controls, hosted file add + drag-drop) |
| 2026-06-12 | Phase 4 bugfix: startup login/logout controls | The startup vault picker only linked out to Settings to connect a hosted server and had no logout. Extracted a shared `HostedLoginForm` (`src/components/server/HostedLoginForm.tsx`) holding the bearer-free `connect`/`reconnect` flow plus up-front URL/username/TLS persistence, and reused it in both `SettingsServerSection` and the picker. The picker now expands an inline login form when disconnected and shows a log-out control (calling `serverStore.disconnect`) beside the refresh/create actions when connected | Full frontend suite (703 tests) incl. rewritten `VaultPicker` inline-login + logout coverage and unchanged `SettingsServerSection` connect/persist tests; TypeScript check | Continue Phase 4 bugfix tasks (hosted file add + drag-drop) |
| 2026-06-12 | Phase 4 bugfix: add files to vault (import + drag-drop) | Added a way to add documents/images/notes to local and hosted vaults, limited to images, PDFs, and markdown. New `src/lib/vaultFileImport.ts` routes each file by type through the mode-agnostic `VaultClient`: images/PDFs upload as binary assets via the existing `externalAssetImport` capability (images default to `Pictures/`, PDFs to the vault root), and markdown is read through the native client and created as a real text note (so it opens/edits like any note) on both local and hosted. Added a `showOpenFilesDialog` Tauri wrapper (multi-select, extension-filtered), a "Add files" button in the Files sidebar header, and a reusable `useNativeFileDrop` hook that hit-tests native OS file drops against the file-tree container (drop onto a folder targets it via `data-tree-folder-path`, else root) with a drop highlight. Import is gated off for hosted viewers (`isVaultReadOnly`). Per-file failures are reported without aborting the batch | Full frontend suite (711 tests) incl. new `vaultFileImport` unit coverage (categorization + routing + markdown-as-note + failure handling) and a FileTree add-files-dialog wiring test; TypeScript check | Phase 4 bugfix list complete except the AppImage workflow deprecation; begin Phase 5 live collaboration |
| 2026-06-12 | Phase 4 bugfix: retire AppImage builds | AppImage is superseded by Flatpak + native packages, so it is no longer built or shipped. Set the Tauri bundle `targets` to an explicit list (`deb`, `rpm`, `nsis`, `msi`, `app`, `dmg`) so `tauri build` stops producing AppImages, and removed every AppImage reference from `.github/workflows/build.yml` (release/artifact globs, the `squashfs-tools` dep, the release-notes download order, and the portable-archive README). The updater `latest.json` generator drops its Linux platform entries because the AppImage was the only Linux self-update target — Linux updates now go through the system package manager (.deb/.rpm) or Flathub. Also updated `scripts/build.sh` and `docs/linux-install.md` to match. The in-app AppImage runtime-channel detection (`ui.rs`/`update.rs`/`App.tsx`) is left intact so any still-installed AppImage degrades gracefully | `tauri.conf.json` + `build.yml` parse-validated; AppImage references confined to intentional explanatory notes | Phase 4 bugfix list complete; begin Phase 5 live collaboration |
| 2026-06-12 | Phase 4 bugfix: serialize saves on slow connections | On slow links (slow internet / self-hosted VPN home servers) quick successive edits could fail with "could not save because the file revision changed in the meantime": the 600 ms autosave fired a second write with the same now-stale optimistic version before the first write returned and updated it, so the server rejected the second as a revision conflict. Added a single-flight `runExclusiveSave` primitive to `src/lib/documentSession.ts` that runs document saves one at a time and coalesces requests made while a save is in flight into a single trailing save using the latest content + the version returned by the prior write. Wired it into the note (`NoteView`), Kanban (`KanbanPage`), and canvas (`useCanvasDocumentSession`) autosave/manual-save paths. Genuine cross-user conflicts still surface normally; only the self-overlap race is eliminated | Full frontend suite (714 tests) incl. new `runExclusiveSave` single-flight/coalescing unit tests and a NoteView slow-connection regression test (overlapping autosaves collapse to one trailing write with the updated revision); TypeScript check | Phase 4 bugfix list complete; begin Phase 5 live collaboration |
| 2026-06-15 | Phase 5 awareness relay foundation | Implemented the server and native-provider foundation for ephemeral rich awareness. WebSocket rooms now relay bounded `AWARENESS` payloads (binary tag 3) per subscribed document, allow read-only viewers to participate, retain only the latest active-session payload in memory for late-subscriber replay, and remove it on unsubscribe/disconnect without ever writing it to the CRDT log or materialized content. `WebSocketYProvider` now sends/applies y-protocols awareness updates with remote-echo suppression, reconnect replay, and malformed-peer-payload isolation. Hosted note, Kanban, and canvas sessions publish their effective server identity plus document kind/path; note cursor/selection rendering can now flow through the existing y-codemirror binding. | Full frontend suite incl. local-send/remote-apply/no-echo/malformed-awareness coverage; TypeScript check; `cargo test --workspace`; `cd src-tauri && cargo test`; live-PG server test covers owner/viewer relay, late-subscriber replay, and non-persistence | Bind rich Kanban/canvas interaction awareness into their UIs, surface live peers consistently, then implement server-routed chat |
| 2026-06-15 | Phase 5 live-open data-loss + canvas crash fix | Fixed a destructive live-session startup race: the native Yjs provider now waits until the initial server state-vector response has been applied before exposing the session to note/Kanban/canvas editors, so an empty local document cannot bind before the server seed arrives. Server rooms defensively recover an empty legacy note CRDT from a non-empty current revision, and handshake/no-op CRDT updates no longer wake the revision materializer. Hardened canvas live-state loading by dropping incomplete nodes/dangling edges and guarding edge geometry against transient nodes without positions. | Full frontend suite incl. initial-sync readiness, malformed canvas-state, and edge-layout crash regressions; TypeScript check; live-PG recovery test; `cargo test -p collab-server`; `cargo check --workspace` | Continue rich Kanban/canvas awareness UI; affected already-materialized blank notes may need restoration from revision history |
| 2026-06-15 | Phase 5 structured live hydration fix | Fixed the remaining structured-document hydration race that made hosted canvas elements appear briefly and then disappear: canvas live writes are now blocked until ReactFlow state exactly matches the initial server snapshot, remote snapshots reset that barrier, and an empty live root falls back to REST instead of being seeded from potentially stale initial React state. Applied the same empty-root safety rule to Kanban. Genuine canvas edits begin writing normally after hydration. | Full frontend suite incl. a regression that proves initial empty React state cannot overwrite a populated live canvas, while a post-hydration edit still writes; TypeScript check | Continue rich Kanban/canvas awareness UI |
| 2026-06-15 | Phase 5 structured-number compatibility fix | Fixed hosted canvas elements disappearing again followed by a native `JSON.stringify` crash. Root cause: the server encoded integral structured-document JSON fields (positions, dimensions, viewport values) as Yjs BigInt, which arrived as JavaScript `bigint`; canvas numeric validation rejected those fields and JSON serialization then threw. The server now emits all structured JSON numbers as Yjs Number, the frontend normalizes legacy/incoming BigInt values to ordinary JSON numbers, and the reconciler uses structural equality rather than stringify-based equality. | Full frontend suite incl. bigint normalization/reconciliation regression; TypeScript check; live structured-document server test; `cargo test -p collab-server`; `cargo check --workspace` | Continue rich Kanban/canvas awareness UI |
| 2026-06-15 | Phase 5 canvas live-sync safety rollback | Temporarily disabled hosted canvas live synchronization after repeated startup/reconciliation regressions damaged persisted canvas state. Hosted canvases now stay on the revision-backed REST path, and hosted canvas sanitization no longer auto-persists repair writes. Note and Kanban live sessions remain enabled. Canvas live sync must not be re-enabled until room reset/reseed, revision restore integration, integrity checks, and destructive regression coverage are complete. | Frontend regression confirms hosted canvases never open/write a live JSON session; TypeScript check; full frontend suite | Restore affected canvases from revision history; design safe canvas CRDT recovery/reseed before re-enabling |
| 2026-06-15 | Structured file import/recovery path | Extended the Files-sidebar picker and native drag/drop import pipeline to accept `.canvas` and `.kanban` files for both local and hosted vaults. Structured files are read natively, lightly validated (`nodes`/`edges` for canvas, `columns` for Kanban), then created and written through the selected `VaultClient` as text documents while preserving the supplied JSON. This provides a manual recovery/import path when revision history is unavailable. | Frontend import classification/routing/validation coverage; FileTree picker coverage; TypeScript check | Continue safe canvas CRDT recovery design |
| 2026-06-14 | Phase 5 Kanban + canvas live co-editing (tasks 5-6) | Structured documents now co-edit live. Model: a Yjs `Y.Map` named `doc` mirrors the JSON (objects→`Y.Map`, arrays→`Y.Array`, primitives direct). New `src/lib/liveJsonDocument.ts` provides a deep, id-aware reconciler (`reconcileMap`/`reconcileArray`) so concurrent edits to different cards/columns/nodes/edges merge, plus `openLiveJsonSession` (built on the refactored shared `WebSocketYProvider`/`connectLiveProvider` from `liveDocumentSession.ts`). `KanbanPage` and `useCanvasDocumentSession` open a live JSON session for hosted boards/canvases, apply remote changes via `onChange`, and push local edits via debounced `writeJson` (a no-op when the value already matches the shared doc, so remote applies don't echo); REST stays the fallback. Server: `crate::ws` rooms now seed and materialize Kanban/canvas by building nested `yrs` shared types from REST JSON (`json_to_in`) and serializing the `doc` map back to a `.kanban`/`.canvas` revision (`to_json`); empty structured docs are never materialized over real content. | `cargo test -p collab-server` (30 tests, incl. new JSON seed+field-edit-materialize live-PG test); `pnpm test` (440 tests, incl. new `liveJsonDocument` reconciler tests covering id-keyed merge, insert/remove, and two-doc concurrent convergence); `pnpm exec tsc --noEmit`; `cargo check --workspace` | Ephemeral presence/rich awareness + server-routed chat (Unit 4); update-log compaction (Unit 5) |
| 2026-06-14 | Phase 5 note live co-editing (task 4 + reconnect + materialization) | Notes now co-edit live end-to-end. Server: note rooms seed their `yrs` doc from current REST content on first open, and a debounced per-room materializer writes live CRDT state into a normal `.md` text revision (reusing the Phase 3 revision/manifest/activity path) so REST reads, history, search, and export stay valid. Native: a `hosted_ws_ticket` Tauri command (`hostedWsTicket` wrapper) exchanges the in-memory bearer for a single-use ticket + `ws(s)://` URL (token never enters the webview); a new `src/lib/liveDocumentSession.ts` WebSocket Yjs provider speaks the Unit-1 protocol with auto-reconnect/backoff and the state-vector handshake; `VaultClient.resolveLiveSession` resolves the hosted file id; `MarkdownEditor` gained a `collabExtension` (y-codemirror.next `yCollab`) path that disables controlled-content sync; `NoteView` opens a live session for hosted notes when connected and disables the REST autosave (REST remains the fallback when the socket is unreachable). Added `yjs`/`y-protocols`/`y-codemirror.next`. | `cargo test -p collab-server` (29 tests, incl. new live-PG seeding + materialize-to-revision tests); `pnpm test` (433 tests, incl. new `liveDocumentSession` provider protocol coverage and a NoteView live-vs-REST selection test); `pnpm exec tsc --noEmit`; `cargo check --workspace`; `cd src-tauri && cargo test` | Kanban + canvas live co-editing (Unit 3): shared maps/arrays bound into KanbanPage/canvas with the same live-or-REST selection and `.kanban`/`.canvas` materialization |
| 2026-06-14 | Phase 5 foundation (tasks 1-3) | Added the CRDT + WebSocket foundation. New migration `0011_crdt_documents.sql` adds hashed single-use `ws_tickets`, a compacted `crdt_documents` state blob, and an append-only `crdt_updates` log. Added `yrs` and a `crate::ws` module: a per-document `Room` (yrs `Doc` + persisted ordered update log + tokio broadcast fan-out), a lazily-created per-file `Hub` on `AppState`, the `GET /ws/v1/vaults/{vaultId}` upgrade handler, and `POST /api/v1/auth/ws-ticket` (read-access-gated, hashed, short-TTL via new `COLLAB_WS_TICKET_TTL_SECONDS`, default 30s). Protocol: JSON control frames (`authenticate`/`ready`/`document.subscribe`/`document.subscribed`/`document.unsubscribe`/`ping`/`pong`/`error`) and binary `[tag][fileId][yjs-v1-payload]` frames (`SYNC_STEP1`/`SYNC_UPDATE`), wire-compatible with browser Yjs. Authz on every message: read access to subscribe, editor (`file.write`) on an active vault to apply updates; viewers get a read-only stream. Reused the REST capability resolver (`resolve_vault_capabilities`) for session authz | `cargo test -p collab-server` (27 tests, incl. new live-PG WS tests: two-client convergence, append-log persistence + author, fresh-client reconnect via sync handshake, viewer-write denial, invalid/foreign-vault/reused-ticket rejection) and `cargo test -p collab-protocol` (WS control-frame wire-format lock); `cargo check --workspace`. Added a shared `db_test_guard` to serialize live-PG tests | Implement note collaboration (shared text) + frontend Yjs provider/binding with REST fallback, server materialization to `.md` revisions, and reconnect (Unit 2) |
| 2026-06-15 | Phase 5 protocol version negotiation | Completed live-protocol version negotiation across the handshake. The server already rejected a mismatched `authenticate.protocolVersion` with `ProtocolVersionUnsupported` before consuming the single-use ticket and echoed its version in `ready`; added live-PG test coverage proving an incompatible version is rejected before `ready` and that the still-unused ticket then admits a correctly-versioned client. Hardened the native provider (`src/lib/liveDocumentSession.ts`): introduced a client `PROTOCOL_VERSION` constant (sent in `authenticate`, replacing the hardcoded literal), validation of the server's advertised `ready.protocolVersion` (a mismatch refuses to subscribe), and a new `fatal` state that distinguishes unrecoverable failures from transient ones — a `protocol_version_unsupported` error (or a `ready` version mismatch) now stops the reconnect loop and falls back to REST, whereas an expired single-use ticket still reconnects with a fresh one. | `cargo test -p collab-server ws::` against live PostgreSQL (9 tests incl. the new `unsupported_protocol_version_is_rejected_before_ready`); `cargo test -p collab-protocol`; `cargo check -p collab-server`; `pnpm test` (462 tests incl. two new provider cases: version-mismatch refuses to subscribe, fatal version error does not reconnect); `pnpm exec tsc --noEmit` | Phase 5 remaining: chat over the server transport and metrics exposure; bind canvas awareness once canvas live sync is re-enabled |
| 2026-06-15 | Phase 5 admin web auto-refresh | Added background auto-refresh to the admin web app so server-side changes appear without a manual reload. New shared `apps/admin-web/src/useAutoRefresh.ts` hook layers polling on top of each page's existing `load` callback (read through a ref so the interval is never torn down on re-render) without changing initial-load semantics: it re-runs `load` on a 15s interval, immediately on window focus, and when a hidden tab becomes visible again, and skips polling entirely while the tab is hidden. Wired into the Dashboard, Users, Vaults, vault-detail, Permissions, and Audit pages (the audit page's inline effect was refactored into a `load` callback). Made the dashboard/users/vaults loads clear a stale error banner on a successful poll so transient network blips during background refresh do not stick. | `pnpm admin:test` (37 tests, incl. 6 new `useAutoRefresh` cases: no mount load, interval polling, hidden-tab skip + visibility refresh, focus refresh, latest-callback, disabled); `tsc --noEmit -p apps/admin-web/tsconfig.json` | Phase 5 remaining: ephemeral chat over the server transport, protocol version negotiation, and metrics exposure |
| 2026-06-15 | Phase 5 canvas live sync re-enabled + canvas awareness | Safely re-enabled hosted canvas live co-editing (rolled back in the 2026-06-15 safety rollback) and bound canvas rich awareness, completing the "ephemeral presence and rich awareness" task for all three document kinds. Server (`crates/collab-server/src/ws.rs`): split `MaterializeKind::Canvas` from `Json`; dropped the canvas-subscribe rejection; added a load-time structured-recovery path that resets a degenerate room (empty root, or a canvas that has lost all nodes vs the canonical REST revision) by reseeding from REST and compacting away the stale CRDT update log; and added a materializer destructive-write guard that refuses to write a node-losing canvas over a populated revision (the room self-heals on its next load). Frontend: flipped `LIVE_CANVAS_ENABLED` to true (existing hydration barrier / `lostRestNodes` guard / empty-root REST fallback retained); `useCanvasDocumentSession` now publishes ephemeral `canvas.selectedNodeIds` awareness (only on selection change) and returns the live session; `CanvasPage` renders the shared `LivePeers` strip in its top bar and rings nodes a remote peer has selected in that peer's color via a new `.canvas-node-remote-selected` rule. | `cargo test -p collab-server ws::` against live PostgreSQL (11 tests incl. new `canvas_node_loss_is_not_materialized_over_a_populated_revision` and `degenerate_canvas_room_recovers_from_revision_on_load`); `cargo check --workspace`; `pnpm test` (463 tests incl. rewritten canvas hydration test asserting live-open + post-hydration write, and a new selection-awareness publish test); `pnpm exec tsc --noEmit`. NOTE: a pre-existing unrelated failure in `api::tests::browser_admin_lifecycle_is_authorized_and_csrf_protected` (admin force-delete returns 204 vs 400) exists in the uncommitted `api.rs` work and is outside this change. | Phase 5 remaining: server-routed chat (transport migration) and metrics exposure |
| 2026-06-15 | Phase 5 awareness UI binding | Bound the ephemeral awareness relay into the document UIs (read side of the foundation). New shared `src/lib/liveAwareness.ts` types the awareness state shape (`user`/`document` + per-kind `kanban`/`canvas` interaction), with `readRemotePeers`, `dedupePeersByUser`, `buildKanbanCardEditors`, and a `useLivePeers` hook that subscribes to the y-protocols `Awareness` `change` event and excludes the local client. New shared `LivePeers` strip (`src/components/collaboration/LivePeers.tsx`) renders one avatar per co-editor (deduped by user) with a pulsing live dot, distinct from the coarse filesystem `PresenceBar`. Notes already render remote cursors via `yCollab`; added a `LivePeers` overlay to `NoteView`. Kanban now publishes the card it has open as `kanban.editingCardId` awareness (ephemeral, never persisted) centralized in `KanbanPage`, exposes `livePeers`/`remoteCardEditors` through `KanbanContext`, shows the live strip in the board top bar, and rings the card a remote peer is editing with their colored avatar in `KanbanCard`. Canvas awareness publish stays in place but is dormant while hosted canvas live sync remains flag-disabled (`LIVE_CANVAS_ENABLED`). | `pnpm test` (460 tests, incl. new `liveAwareness` hook/helper coverage and `LivePeers` rendering coverage; updated Kanban board context mock); `pnpm exec tsc --noEmit`. No Rust changes (relay already implemented) | Server-routed chat (transport migration), then protocol version negotiation and metrics; bind canvas awareness once canvas live sync is safely re-enabled |
| 2026-06-17 | Phase 5 server-routed chat | Added hosted chat delivery through the server transport. New migration `0012_hosted_vault_chat.sql` stores server-authoritative `hosted_chat_messages`; `/api/v1/vaults/{vaultId}/chat` lists and sends bounded messages with vault read access, active-vault enforcement on send, client UUID idempotency, and authenticated sender stamping. The frontend `HostedServerTransport` uses the bearer-hidden `hostedVaultRequest` gateway and the existing chat panel now works for hosted vaults instead of showing an unavailable state. | Full frontend suite (464 tests), `pnpm exec tsc --noEmit`, `cargo check -p collab-server`, `cargo test -p collab-protocol`, and live-PG server lifecycle coverage for hosted chat send/list/validation | Phase 5 remaining: metrics for live connections, rooms, update rates, compaction, and web UI exposure |
| 2026-06-17 | Phase 5 observability + admin chat log (gate closed) | Fixed hosted chat identity drift by rendering optimistic and echoed messages against the effective server identity (`useCollabIdentity`) instead of the local client identity. Added real CRDT log compaction to the quiet-period live-room worker: after materialization it folds the room's current Yjs state into `crdt_documents`, records the covered update sequence, and deletes compacted `crdt_updates` rows while holding the room sequence lock. Added live-collaboration metrics to the admin overview and dashboard: active WebSocket connections, loaded rooms, active awareness states, recent update count, pending CRDT update-log size, compacted document count/bytes, and last compaction timestamp. Added a read-only hosted-vault chat log to the admin vault detail screen, backed by the same server-authoritative chat endpoint used by collaboration clients. | `pnpm test` (465 tests), `pnpm exec tsc --noEmit`, `pnpm admin:test` (37 tests), `pnpm admin:build`, `cargo check -p collab-server`, `cargo test -p collab-protocol`, `cargo test -p collab-server` (36 tests, incl. compacted-state restart recovery) | Phase 5 complete; begin Phase 6 when ready |
| 2026-06-17 | Phase 6 replica-store foundation | Added the native hosted-vault offline replica store, the foundation for Phase 6. New `src-tauri/src/replica/` module (`models.rs` + `store.rs`) implements a filesystem + JSON per-vault replica under the app config dir (`replicas/{sha256(serverUrl)}/{vaultId}/`): last-known server manifest, `ReplicaSyncState`, a tombstone list, an append-only pending-operation queue (`pending-ops.jsonl`) with typed `PendingOperation`/`PendingOpKind`/`PendingOpStatus` models, cached document/asset content, and sidecar checksums in `integrity.json` for corruption detection (`verify`/`rebuild`). Writes are atomic (temp-file + fsync + rename). Stores vault content only — never tokens. Extracted the shared `app_config_dir` helper into `commands/mod.rs`. Exposed 18 `replica_*` Tauri commands (`commands/replica.rs`), typed frontend wrappers in `src/lib/tauri.ts`, and a `src/lib/vaultReplica.ts` model mirror + `seedReplicaFromManifest` helper. Opening a hosted vault now seeds the replica from the server manifest (best-effort; never blocks open), and `HostedVaultClient.readDocument` write-through-caches read content. Also added encoded-CRDT-state persistence to the replica (`crdt/{fileId}.bin`) with `cache_crdt_state`/`read_cached_crdt_state` and base64 `replica_cache_crdt_state`/`replica_read_crdt_state` commands, completing the "persist manifests, CRDT state, cached assets, tombstones, and pending operations" task. | `cd src-tauri && cargo test` (112 tests, incl. 9 new replica store tests: meta/manifest/sync-state round-trip, pending-op ordering, tombstone dedupe, document/asset/CRDT-state cache, verify/rebuild corruption recovery, delete, server-key stability), `cargo check --workspace`, `pnpm test` (474 tests, incl. new `vaultReplica` seed coverage, vaultStore seed-on-open + seed-failure-still-opens, and HostedVaultClient write-through caching), `pnpm exec tsc --noEmit` | Phase 6 remaining: reconnect synchronization via CRDT state vectors, manifest delta sync, offline structural operations + conflict recovery, resumable uploads, bounded cache cleanup, and sync/conflict UI |
| 2026-06-17 | Phase 6 reconnect sync (notes) | Implemented reconnect synchronization via CRDT state vectors for hosted notes on top of the replica's CRDT-state cache. `WebSocketYProvider` gained an `offlineReplica` mode (enabled through `connectLiveProvider`'s new `ConnectLiveOptions`, set by `openLiveNoteSession`): it seeds the `Y.Doc` from `crdt/{fileId}.bin` via `hydrateFromReplica` before the socket opens, then the existing handshake — client `SYNC_STEP1`(state vector) plus the server's own `SYNC_STEP1` reply (`ws.rs`) — reconciles offline edits (uploaded as the client's `encodeStateAsUpdate(serverSV)`) with server-side changes; the merged state is debounce-persisted back to the replica on every change and flushed on destroy. Seed updates carry a dedicated `SEED_ORIGIN` so they are neither re-broadcast as fresh local edits nor re-persisted. Structured (Kanban/canvas) documents intentionally stay REST-seeded (`offlineReplica` off) so their hydration guards never observe replica-seeded state. | `pnpm test` (476 tests, incl. two new provider cases: seeds the doc from the replica before connecting so offline content survives the handshake, and debounce-persists merged CRDT state after a local edit), `pnpm exec tsc --noEmit`; `liveJsonDocument` suite unchanged (structured path still bypasses the replica) | Phase 6 remaining: offline structural operations + conflict recovery, resumable uploads, bounded cache cleanup, structured-doc reconnect sync, and sync/conflict UI |
| 2026-06-18 | Phase 6 manifest delta synchronization | Added real hosted manifest delta synchronization for native replicas. The server now tracks a per-file `manifest_sequence` marker, advances it for create/upload/import, REST and live materialized revisions, revision/snapshot restore, and structural subtree operations (including rewritten reference documents), and exposes `GET /api/v1/vaults/{vaultId}/manifest/delta?since={sequence}` with only changed manifest file entries. The native frontend added `syncReplicaManifestDelta`, which merges changed entries by stable file ID into the cached replica manifest, advances replica sync-state, and falls back to full seeding when the local cache is missing or unsafe. Hosted file-tree and lightweight hosted note-index reads now refresh through this delta path. | Focused frontend suite (`pnpm test -- src/lib/vaultReplica.test.ts src/lib/vaultClient.test.ts src/store/vaultStore.test.ts`, 478 tests due import fan-out), `pnpm exec tsc --noEmit`, `cargo check -p collab-server`, and live-PG server lifecycle coverage for empty and changed manifest deltas | Phase 6 remaining: offline structural operations + conflict recovery, resumable uploads, bounded cache cleanup, structured-doc reconnect sync, and sync/conflict UI |
| 2026-06-18 | Phase 6 offline structural queue foundation | Started offline structural operation support for hosted vaults. When a hosted rename, move, trash, restore, or purge/delete operation cannot reach the server, the client now resolves the target from the cached replica manifest, writes an optimistic replica manifest update by stable file ID/subtree, marks replica sync-state `offline`, and appends a replayable pending operation with the original `clientOperationId`, `baseManifestSequence`, target file ID, operation payload, and pending status. Hosted file-tree and note-index reads already fall back to the cached replica manifest, so pending structural changes are visible while offline. This intentionally does not yet replay the queue or resolve conflicts. | `pnpm test -- src/lib/vaultReplica.test.ts src/lib/vaultClient.test.ts` (481 tests due import fan-out), `pnpm exec tsc --noEmit` | Phase 6 remaining: pending structural operation replay, create/edit offline queueing, resumable uploads, conflict recovery, bounded cache cleanup, structured-doc reconnect sync, and sync/conflict UI |
| 2026-06-18 | Phase 6 offline create/edit/structural replay | Finished the offline operation queue path for hosted vault content. Hosted create document/folder and document edit now fall back to the cached replica when the server is unreachable, write optimistic manifest/document cache updates, and enqueue replayable pending operations. The pending-operation replay runs before manifest delta sync, resets abandoned inflight entries, maps temporary offline file IDs returned by queued creates to real server file IDs for dependent edits/structural operations, removes successful operations, and marks validation/conflict failures as failed without replaying later dependent operations. Trash purge now also uses the cached manifest path while offline. Empty queues no longer trigger a full manifest reseed, preserving delta sync behavior. | `pnpm exec tsc --noEmit`; `pnpm test -- src/lib/vaultReplica.test.ts src/lib/vaultClient.test.ts src/store/vaultStore.test.ts` (485 tests due import fan-out) | Phase 6 remaining: conflict/recovery UI, resumable uploads, bounded cache cleanup, structured-doc reconnect sync, revoked/deleted-vault handling, and multi-client convergence gate |
| 2026-06-18 | Phase 6 offline conflict recovery foundation | Added durable recovery metadata for irreconcilable pending-operation replay failures. Pending operations now persist optional `failureCode` and `failureMessage`; the native replica store exposes `replica_record_operation_failure`; replay classifies known server rejections (`manifest_conflict`, `revision_conflict`, `path_conflict`, permission revocation, vault unavailable) and records the failed operation without replaying dependent operations or silently dropping local changes. Frontend helpers now list failed-operation recoveries with recommended actions and expose retry/discard primitives for the upcoming sync UI. | `pnpm exec tsc --noEmit`; `pnpm test -- src/lib/vaultReplica.test.ts` (489 tests due import fan-out); `pnpm test -- src/lib/vaultClient.test.ts src/store/vaultStore.test.ts` (489 tests due import fan-out); `cd src-tauri && cargo test replica` (9 tests). One combined Vitest run was retried in smaller chunks after an unrelated `CanvasPage` fan-out failure. | Phase 6 remaining: resumable uploads, bounded cache cleanup, sync-status/pending-change UI, structured-doc reconnect sync, revoked/deleted-vault handling, and multi-client convergence gate |
| 2026-06-18 | Phase 6 retryable binary uploads | Added durable retry for interrupted hosted binary uploads. Hosted asset imports now cache upload bytes in the native replica asset cache, write an optimistic active asset entry into the replica manifest, and enqueue an `assetUpload` pending operation when the server becomes unreachable during upload. Replay restores the cached bytes via `replica_read_cached_asset`, maps any offline-created parent folder ID to its real server ID, POSTs the normal digest-verified `/uploads` request, and then removes the operation. This does not introduce chunk-level upload protocol support; it makes interrupted uploads resumable from the local replica after reconnect/restart without depending on the original desktop file path. | `pnpm exec tsc --noEmit`; `pnpm test -- src/lib/vaultReplica.test.ts src/lib/vaultClient.test.ts src/store/vaultStore.test.ts` (491 tests due import fan-out) | Phase 6 remaining: bounded cache cleanup, sync-status/pending-change UI, structured-doc reconnect sync, revoked/deleted-vault handling, and multi-client convergence gate |
| 2026-06-18 | Phase 6 sync-status + recovery UI | Surfaced the offline-sync state to the user. New `syncStore` holds the open hosted vault's replica sync status, last-synced time, pending operations, and failed-operation recoveries, with `syncNow`/`retry`/`discard` actions. New status-bar `SyncStatusIndicator` (hidden for local vaults) shows a compact rollup chip (Synced / Syncing… / N pending / N conflicts) and a popover with the pending-change list, a manual "Sync now", and per-conflict Retry/Discard recovery. It stays dynamic via a new `onReplicaMutated` emitter in `vaultReplica.ts` (fired by enqueue/replay/seed/delta-sync), a focused ~5s poll, `serverStore.status` changes, and window focus/online events; a newly-surfaced conflict raises a toast. | `pnpm exec tsc --noEmit`; `pnpm test -- src/store/syncStore.test.ts src/components/layout/SyncStatusIndicator.test.tsx` (511 tests due import fan-out, incl. new rollup/refresh/syncNow/retry/discard store coverage and indicator render/pending/conflict-recovery coverage) | Phase 6 remaining: structured-doc (Kanban/canvas) reconnect sync, revoked/deleted-vault handling, and the multi-client convergence gate |
| 2026-06-18 | Phase 6 bounded cache cleanup | Added bounded replica cache cleanup so offline caches don't grow without limit. New `ReplicaStore::cleanup(budget_bytes)` (exposed as the `replica_cleanup` Tauri command + `CacheCleanupReport`) sweeps stray atomic-write temp files, evicts cached document/asset/CRDT content for files no longer active in the cached manifest, and LRU-evicts (oldest `mtime` first) the remaining entries until the cache fits its byte budget — while never evicting content referenced by a pending operation (those bytes are the only local copy of unsynced data). Frontend `cleanupReplicaCache` + `REPLICA_CACHE_BUDGET_BYTES` (512 MiB) wrap it, and `vaultStore.openHostedVault` runs cleanup best-effort after replica seeding (never blocks open). | `cd src-tauri && cargo test` (115 tests, incl. 3 new cleanup tests: orphan eviction preserving active + pending-referenced content, budget LRU eviction never touching pending, stray-temp removal); `cargo check`; `pnpm exec tsc --noEmit`; `pnpm test -- src/lib/vaultReplica.test.ts src/store/vaultStore.test.ts` (501 tests due import fan-out, incl. new cleanup-wrapper coverage) | Phase 6 remaining: sync-status/pending-change/conflict/recovery UI, structured-doc reconnect sync, revoked/deleted-vault handling, and multi-client convergence gate |
| 2026-06-18 | Phase 6 structured-doc reconnect sync | Brought Kanban/canvas to parity with notes for offline reconnect. `openLiveJsonSession` now opens with `offlineReplica` enabled, so a structured live session seeds its `Y.Doc` from the replica's `crdt/{fileId}.bin` before connecting and persists merged CRDT state on change — unflushed live edits survive an app restart and reconcile via the state-vector handshake (within-session reconnect already worked via the in-memory doc). Added `WebSocketYProvider.discardOfflineState()` (on the live handle) + a new `replica_clear_crdt_state` command / `ReplicaStore::clear_cached_crdt_state`: the Kanban empty-root and canvas empty/`lostRestNodes` open guards now discard the offline seed (stop persisting, skip the flush-on-destroy, clear the cached state) so a degenerate cached state can never persist and re-poison the next session. | `cd src-tauri && cargo test` (116, incl. clear-CRDT round-trip + tolerate-missing); `cargo check`; `pnpm exec tsc --noEmit`; `pnpm test -- src/lib/liveDocumentSession.test.ts src/components/canvas/useCanvasDocumentSession.test.tsx src/views/KanbanPage.test.tsx` (517 due import fan-out, incl. new structured offline-seed and discard/skip-persist provider coverage) | Phase 6 tasks complete; remaining work is the completion-gate verification (two-client offline convergence) |
| 2026-06-18 | Phase 6 gate closed | Audited the full offline-sync stack and closed the completion gate. Evidence: live WebSocket rooms still prove two-client convergence and server-side permission rechecks; note and structured JSON sessions seed/persist offline CRDT state through the replica; pending structural operations are replayed by stable IDs and failed conflicts remain durable with retry/discard recovery; interrupted asset uploads replay from replica-cached bytes; access loss is surfaced as revoked/unavailable without deleting local data; replica integrity verification/rebuild and bounded cleanup are covered by native tests. | `pnpm exec tsc --noEmit`; `pnpm test -- src/lib/vaultReplica.test.ts src/lib/vaultClient.test.ts src/lib/liveDocumentSession.test.ts src/store/syncStore.test.ts src/components/layout/SyncStatusIndicator.test.tsx src/store/vaultStore.test.ts` (517 tests due import fan-out); `cd src-tauri && cargo test replica` (13 tests); `cargo test -p collab-server ws::` (13 tests, incl. two-client convergence, viewer denial, role-change permission recheck, structured materialization/recovery, and compaction recovery) | Phase 6 complete; begin Phase 7 production hardening when ready |
| 2026-06-18 | Phase 7 automated backups | Added the first production-hardening slice: an optional Compose `backup` profile that runs scheduled PostgreSQL custom-format dumps and blob-volume archives into the shared backups volume, with retention pruning, checksums, manifests, and sanitized non-secret configuration capture. Added a one-shot `./scripts/server-backup.sh` helper and documented backup operation in the server docs. | `sh -n scripts/server-backup-container.sh`; `bash -n scripts/server-backup.sh`; `docker compose config`; `docker compose --profile backup config`; live one-shot backup via `docker compose run --rm backup /usr/local/bin/collab-backup`; checksum verification inside the backups volume; `git diff --check` | Next Phase 7 task: documented full and per-vault restore procedures |
| 2026-06-18 | Phase 7 restore procedures | Added documented full-deployment and per-vault restore procedures plus a conservative full-restore helper. The restore path verifies backup checksums, requires `COLLAB_RESTORE_CONFIRM=restore`, stops app services via the host wrapper, replaces the PostgreSQL schema from `postgres.dump`, replaces the blob volume from `blobs.tar.gz`, keeps a pre-restore blob safety archive, and restarts services unless opted out. Per-vault restore is documented as content-level recovery through Trash/history/snapshots or staged full-backup restore plus hosted ZIP export/import. | `sh -n scripts/server-restore-container.sh`; `bash -n scripts/server-restore.sh`; `docker compose --profile restore config`; `docker compose --profile backup --profile restore config`; isolated disposable Compose project `collab-restore-smoke` backup/restore roundtrip restored both a seeded PostgreSQL row and blob payload; `git diff --check` | Next Phase 7 task: backup verification and restore tests |
| 2026-06-18 | Phase 7 backup verification and admin UI | Added repeatable backup/restore verification through `./scripts/server-backup-restore-smoke.sh`, which creates a disposable Compose project, seeds PostgreSQL and blob data, runs backup, verifies checksums, corrupts both values, restores, and asserts the original data returns. Added admin backup-management APIs and UI: list visible backup directories, verify checksums, delete old backups, and expose guarded Run/Restore actions that only activate when operator command hooks are configured. | `sh -n`/`bash -n` backup scripts; `cargo test -p collab-server backup_verifier_checks_artifact_hashes_and_rejects_unsafe_names`; `cargo check -p collab-protocol`; `cargo check -p collab-server`; `cargo check --locked -p collab-server`; `pnpm admin:test` (38 tests); `pnpm exec tsc --noEmit -p apps/admin-web/tsconfig.json`; `pnpm admin:build`; `docker compose --profile backup --profile restore config`; `./scripts/server-backup-restore-smoke.sh`; `git diff --check` | Next Phase 7 task: metrics, dashboards, health alerts, and structured audit logs |
| 2026-06-19 | Phase 7 observability and health alerts | Turned existing dashboard metrics and audit data into actionable operator alerts. The admin overview now reports degraded blob storage, missing or stale backups, failed backup/restore audit events, storage pressure against configurable `COLLAB_STORAGE_WARNING_BYTES`, and live-collaboration CRDT compaction backlog using stable warning codes and severity levels. The admin dashboard now shows total storage plus the warning threshold and styles critical/info/warning alerts distinctly. | `cargo check -p collab-server`; `cargo test -p collab-server backup_created_at_parser_accepts_manifest_and_rfc3339_timestamps backup_verifier_checks_artifact_hashes_and_rejects_unsafe_names`; `pnpm exec tsc --noEmit -p apps/admin-web/tsconfig.json`; `pnpm admin:test`; `pnpm admin:build`; `docker compose config`; `git diff --check` | Next Phase 7 task: storage quotas and configurable upload limits |
| 2026-06-19 | Phase 7 admin-configurable runtime settings | Retrofitted server runtime configuration so common operational settings can be managed from `/admin/settings`: secure-cookie behavior, browser/native session TTLs, WebSocket ticket TTL, hosted upload/import limits, storage-pressure warning threshold, and backup schedule/export settings. Persisted GUI values in the server data volume, made request handlers read effective settings without restart, and made explicitly configured `COLLAB_*` environment variables global overrides that lock the matching UI fields. Compose no longer injects defaults for GUI-managed settings, so only real `.env` values become locks. | `cargo check -p collab-server`; `cargo test -p collab-server config::tests`; `cargo test -p collab-server backup_`; `pnpm exec tsc --noEmit -p apps/admin-web/tsconfig.json`; `pnpm admin:test` (39 tests); `pnpm admin:build`; `docker compose config`; `git diff --check` | Continue Phase 7 storage quotas; body-size startup cap and infrastructure paths remain operator-controlled |
| 2026-06-19 | Phase 7 storage quotas | Closed the "storage quotas and configurable upload limits" task (configurable upload/import limits already landed in the runtime-settings slice). Added a hard server-wide storage quota (`COLLAB_STORAGE_QUOTA_BYTES`, GUI-managed alongside the soft warning threshold, env-lockable, `0` = unlimited) enforced against total deduplicated stored content (sum of unique blob sizes). Content-growing operations — asset uploads, text document writes, document creation with initial content, and ZIP imports — recompute the projected stored content (correctly ignoring already-stored and intra-request duplicate digests, matching blob dedup) and reject with `507 QUOTA_EXCEEDED` before any bytes hit the blob store when the quota would be crossed; the internal live-CRDT materialization path is intentionally not gated so live edits are never lost. The admin overview exposes `storedContentBytes`/`quotaBytes` plus distinct `storage_quota_pressure` (>=90%) and `storage_quota_exceeded` (critical) warnings, and the dashboard shows a "Stored content" metric and a quota settings field. Also retrofitted all five byte settings (`max_file`/`max_import`/`max_import_expanded`/`storage_warning`/`storage_quota`) to accept human-readable binary sizes (`256MiB`, `12 GiB`, `1.5GiB`, `512k`) in addition to plain integers: a shared `config::parse_byte_size` parses env vars, a `deserialize_with` helper makes the runtime-settings JSON API accept number-or-string, and the `/admin/settings` byte fields are now text inputs that display/round-trip binary units (`formatByteSize`). | `cargo test -p collab-server --lib quota config:: runtime_settings_request` (14 tests, incl. dedup/threshold math, unlimited/oversized validation, byte-size parser, and string-or-number request deserialization); `cargo check --workspace`; `cargo test -p collab-protocol`; `pnpm exec tsc --noEmit`; `pnpm exec tsc --noEmit -p apps/admin-web/tsconfig.json`; `pnpm admin:test` (39 tests, incl. byte round-trip + string submission); `pnpm admin:build`; `docker compose config` | Next Phase 7 task: REST and WebSocket rate limits |
| 2026-06-19 | Phase 7 REST + WebSocket rate limits | Added coarse per-client-IP rate limiting. A generic fixed-window `RateLimiter` (in `AppState`, keyed by client IP with a 60s window and `Retry-After` reporting) backs a `rate_limit` Axum middleware that guards `/api/v1/*` (REST) and `/ws/v1/*` (WebSocket upgrade) traffic; health checks, the admin SPA, and the root redirect are never limited. Limits are operator-controlled (`COLLAB_REST_RATE_LIMIT_PER_MINUTE` default 1200, `COLLAB_WS_RATE_LIMIT_PER_MINUTE` default 120; `0` disables), consistent with other infrastructure paths. The client key is the last `X-Forwarded-For` hop appended by the trusted gateway (falling back to `X-Real-IP`, then the socket peer via `into_make_service_with_connect_info`); exceeding a limit returns `429 RATE_LIMITED` with `Retry-After`. Established WebSockets additionally get a generous per-connection inbound message flood guard (2,000 frames / 10s, ping/pong exempt) that disconnects a runaway socket, which then reconnects and re-syncs via the state-vector handshake. The limiter map is swept of idle buckets past a key-count threshold to stay bounded. | `cargo test -p collab-server --lib` (53 tests, incl. new `RateLimiter` window/retry-after, `client_key` forwarded-hop precedence, REST burst→429 + health-exempt, and disable-on-zero router tests); `cargo check --workspace`; `docker compose config` | Next Phase 7 task: retention and compaction policies |
| 2026-06-19 | Phase 7 retention + compaction | Added a periodic best-effort maintenance worker (`retention.rs`, spawned from `main`) plus an on-demand admin trigger (`POST /api/v1/admin/maintenance`). It always clears expired `ws_tickets`, expired browser/native sessions, and stale `hosted_presence`; opt-in policies prune `audit_events`/`hosted_vault_activity_events` older than `COLLAB_AUDIT_RETENTION_DAYS` and compact document history to the newest `COLLAB_REVISION_HISTORY_LIMIT` revisions per file. Revision compaction always preserves the current revision and any snapshot-pinned revision, always reclaims all revisions of already-purged (tombstoned) files, and never deletes entry rows (avoiding the no-cascade `parent_id` FK web). A final blob GC deletes `hosted_blobs` no longer referenced by any revision (older than a 1h grace period to dodge in-flight-upload races) from the DB and disk. All knobs are operator-controlled (env), interval default 3600s/min 60; `0` disables each policy. Admin settings page gained a "Run maintenance now" button showing reclaimed counts. | `COLLAB_TEST_DATABASE_URL=… cargo test -p collab-server --lib retention::` (live-PG: prunes expired/stale/audit/activity, compacts to limit while keeping current+snapshot, reclaims tombstoned revisions, GCs orphaned blobs from DB+disk, keeps referenced blobs and valid tickets); `cargo test -p collab-server --lib` (54 non-PG tests); `cargo check --workspace`; `cargo test -p collab-protocol`; `pnpm exec tsc --noEmit -p apps/admin-web/tsconfig.json`; `pnpm admin:test` (39, incl. run-maintenance button); `pnpm admin:build`; `docker compose config` | Next Phase 7 task: migration rollback and failed-upgrade recovery procedures |
| 2026-06-19 | Phase 7 upgrade recovery procedures | Added a concrete failed-upgrade recovery workflow. New `pnpm server:upgrade:preflight` / `./scripts/server-upgrade-preflight.sh` creates a full deployment backup, verifies checksums, captures the current Compose service state and `_sqlx_migrations` table into `server-data/upgrade-preflight/`, and prints the exact restore command to use if the upgrade fails. Added `docs/server/upgrade-recovery.md` with pre-upgrade, upgrade, failed-migration rollback, post-startup regression rollback, and compatibility rules; linked it from the server docs and README. | `bash -n scripts/server-upgrade-preflight.sh`; `bash -n scripts/server-backups.sh`; `pnpm exec tsc --noEmit`; `docker compose config`; `git diff --check` | Next Phase 7 task: graceful maintenance mode |
| 2026-06-19 | Phase 7 graceful maintenance mode | Added persisted maintenance mode controlled from `/admin/settings`. When enabled, health checks, auth, admin routes, backups/restore, settings, and read-only REST requests remain available, while hosted-vault mutations, WebSocket ticket issuance, and live WebSocket upgrades return `503 maintenance_mode` with `Retry-After`. Admin overview surfaces a `maintenance_mode` operational warning with the operator-supplied message. State is stored in the server data/backup volume and survives restarts. | `cargo check -p collab-server`; `cargo test -p collab-server app::tests::maintenance_mode_blocks_mutations_and_websockets_but_allows_reads`; `cargo test -p collab-protocol`; `pnpm exec tsc --noEmit -p apps/admin-web/tsconfig.json`; `pnpm admin:test`; `pnpm admin:build`; `git diff --check` | Next Phase 7 task: security headers, TLS deployment guidance, and secret-rotation procedures |
