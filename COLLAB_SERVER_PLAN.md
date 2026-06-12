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
