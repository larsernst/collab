# Android Companion App Plan

## Summary

Build an Android-first companion app for hosted Collab vaults. The mobile app is
not intended to replace the desktop client. Its job is to make common hosted
workflows available away from a workstation: sign in to servers, keep selected
hosted vaults available offline, read and edit notes, read and edit Kanban
boards, and view richer vault files such as PDFs, images, canvases, and logic
diagrams.

iOS is explicitly out of scope for the initial implementation. The architecture
should not block iOS later, but the first production target is Android.

## Product Scope

### Included In The Initial Mobile Product

- Android app distributed as a companion client.
- Hosted server login, session restore, token refresh, and disconnect.
- Hosted vault list and vault switching.
- Local offline copies for selected hosted vaults, based on the current desktop
  replica model.
- File browsing and search suitable for phone screens.
- Note viewing and editing.
- Kanban viewing and editing.
- PDF, image, canvas, and logic diagram viewing.
- Sync status, manual sync, retry failed operations, and discard queued
  operations.
- Read-only enforcement for hosted viewer permissions.
- Shared visual language with the desktop app: themes, accent colors, typography,
  status chips, document top-bar language, and restrained operational styling.

### Explicitly Out Of Scope For The Initial Product

- iOS builds, signing, App Store distribution, and iOS-specific QA.
- Local filesystem vaults.
- Admin web features.
- Desktop-style multi-tab workspace.
- Full canvas editing.
- Full logic diagram editing.
- SVG/vector editing.
- PDF annotations/highlights/comments editing.
- Image additive or permanent editing.
- Native file drag/drop, external file import, and OS file-manager integration.
- Full live multi-user editing polish. The first mobile editing path can use the
  existing hosted REST/offline-queue document session semantics before adding
  live CRDT editing.

## Technology Direction

Use Tauri 2 mobile for the first spike and likely MVP.

Rationale:

- The desktop app already uses Tauri 2, React, Vite, Rust commands, and a Rust
  hosted replica implementation.
- The current hosted security model intentionally keeps bearer tokens and refresh
  tokens on the native side. A Tauri mobile client can preserve that boundary.
- The native replica store, hashing rules, offline queue, and hosted request
  proxy are easier to share through Rust crates than to rewrite in a React Native
  stack.
- The frontend can still be a mobile-specific React app that reuses shared design
  tokens, stores, DTOs, and selected rendering components.

Capacitor remains a fallback if the Tauri mobile spike fails on WebView,
packaging, plugin, or Android lifecycle constraints. React Native/Expo should be
treated as a larger rewrite option, not the default path, because it would require
duplicating the Rust-native replica and hosted token boundary in JavaScript or
native modules.

## Architecture Target

### Repository Shape

Preferred structure:

```text
apps/mobile-android/
  Android-first Tauri mobile app shell

src/
  Existing desktop frontend

crates/
  collab-core
  collab-protocol
  collab-client-auth       planned shared native session/token helpers
  collab-client-api        planned hosted request/client helpers
  collab-replica           planned shared offline replica implementation
```

The mobile app should not import the desktop `AppShell`. It should use a mobile
shell built around drill-in navigation:

- Server/vault switcher.
- Vault file browser.
- Document viewer/editor screen.
- Sync/activity screen.
- Settings/account screen.

### Shared Code Boundaries

Reuse:

- `collab-core` path/reference rules.
- `collab-protocol` DTOs and error codes.
- Hosted server auth/session concepts.
- Hosted vault API client semantics.
- Offline replica schema and pending-operation model.
- Note markdown render pipeline where practical.
- Kanban document schema and mutation helpers where practical.
- Design tokens, themes, accent colors, and common controls after extraction.

Do not reuse directly:

- Desktop `AppShell`.
- Desktop tab model.
- Desktop sidebar/activity bar layout.
- Desktop canvas/logic editors.
- Desktop file drag/import/export flows.

## Progress Tracker

| Phase | Status | Goal |
| --- | --- | --- |
| 0. Feasibility spike | Complete | Prove Android Tauri mobile can run a Collab shell, call Rust, authenticate, and persist app data. |
| 1. Shared client foundation | Complete | Extract enough auth/API/replica logic so desktop and Android do not fork core hosted behavior. |
| 2. Android mobile shell | In progress | Build phone-first navigation, server access, hosted vault list, and settings/account screens. |
| 3. Offline replica read path | Planned | Seed, cache, open, and browse hosted vault offline copies on Android. |
| 4. Notes MVP | Planned | View, edit, save, queue offline, and sync markdown notes. |
| 5. Kanban MVP | Planned | View and edit boards/cards through a mobile-first Kanban workflow. |
| 6. Viewer-only rich files | Planned | Add PDF, image, canvas, and logic diagram viewers without edit affordances. |
| 7. Android hardening and release prep | Planned | Device QA, lifecycle handling, signing, release packaging, and operational docs. |
| 8. Later expansion | Deferred | Decide whether to add live editing, push/background sync, iOS, or richer viewers. |

## Phase Details

### Phase 0: Feasibility Spike

Estimated effort: 2-3 weeks.

Goals:

- Create a minimal Android Tauri mobile target.
- Render a simple Collab-branded React mobile shell.
- Call a Rust command from the mobile WebView.
- Perform HTTPS requests to a hosted Collab server through native/Rust code.
- Store a test value in app data and retrieve it after app restart.
- Verify Android emulator and one physical Android device.

Acceptance criteria:

- A developer can run the Android app locally.
- The app can connect to a known hosted server health/auth endpoint.
- Native command invocation works from React on Android.
- App-local persistence works across restarts.
- Any blocking Tauri mobile/plugin limitation is documented before deeper work.

Current implementation notes:

- Added a mobile-specific React entrypoint in `apps/mobile-android`.
- Added `src-tauri/tauri.android.conf.json` so Android builds use the mobile
  shell and `dist-mobile` instead of the desktop app.
- Added a native server health command, native auth probe, and app-data
  persistence probe that reports whether a previous value was restored.
- Added Android build scripts and detailed APK build instructions in
  `docs/android-companion-build.md`.
- Verified on a physical Android device with a debug APK and reachable hosted
  test server.
- Android refresh-token persistence started as a compile-safe placeholder during
  Phase 0 and is replaced by Android Keystore-backed storage in Phase 1.

Exit decision:

- Continue with Tauri mobile if auth, HTTPS, filesystem/app-data persistence, and
  WebView performance are acceptable.
- Reevaluate Capacitor only if Tauri mobile blocks a required primitive.

### Phase 1: Shared Client Foundation

Estimated effort: 3-5 weeks.

Goals:

- Extract hosted native-session refresh logic from desktop command code into a
  shared Rust module or crate.
- Extract hosted request construction, digest validation helpers, and error
  normalization into a shared client layer.
- Extract the hosted replica store from desktop-only Tauri commands into a shared
  Rust crate with thin desktop/mobile command wrappers.
- Keep token storage platform-specific behind a small trait/interface.
- Preserve the invariant that bearer tokens do not enter the webview.

Acceptance criteria:

- Desktop behavior is unchanged after extraction.
- Android can call the shared auth/API/replica logic through its own commands.
- Refresh-token rotation remains serialized per server.
- Local replica data is stored in Android app-private storage.
- Existing desktop tests still pass.

Current implementation notes:

- Extracted hosted server URL validation, HTTP client construction, WebSocket
  HTTP/1.1 client construction, request error normalization, hosted request
  method/path validation, identifier validation, native-session decoding, and
  hosted JSON/error decoding into `src-tauri/src/hosted_client.rs`.
- Extracted refresh-token persistence into `src-tauri/src/server_token_store.rs`
  so Android Keystore support can replace the current mobile placeholder without
  changing hosted session orchestration.
- Added Android Keystore-backed refresh-token persistence through the generated
  Android project and a mobile restore-session probe for testing app restart
  session recovery.
- Added a mobile hosted-vault list probe through the native hosted request
  gateway, verifying that restored Android sessions can call authenticated
  hosted APIs without exposing bearer tokens to the WebView.
- Routed Android app configuration and replica storage through the app-private
  files directory, with a mobile replica-list probe to verify the native replica
  store can open on device before full offline seeding is added.
- Rewired desktop and Android Tauri commands to use the shared hosted-client and
  token-store modules while leaving live session state in the Tauri boundary for
  the next Phase 1 slice.
- Extracted the native hosted-session orchestration (refresh-token resolution,
  the serialized refresh-token rotation lock, access-token freshness checks, and
  `session_for`/`fresh_session_for`) out of `commands/server.rs` into the shared
  `src-tauri/src/hosted_session.rs` module. The desktop and Android command
  wrappers, plus the live-collaboration WebSocket, now share one session
  lifecycle instead of forking it, refresh-token rotation stays serialized per
  server through `AppState.server_refresh_lock`, and bearer/access tokens still
  never leave the backend. Desktop behavior and all existing backend tests are
  unchanged.
- Promoted the native hosted-vault replica store into the shared
  `crates/collab-replica` workspace crate (moved `models.rs` and `store.rs` out
  of `src-tauri/src/replica/`). `src-tauri/src/replica.rs` is now a thin
  re-export so the `replica_*` Tauri command wrappers in `commands/replica.rs`
  are unchanged and remain the desktop/Android boundary. To avoid forking the
  `CENC` at-rest container format between desktop vault encryption and the
  replica store, the byte-level AES-256-GCM primitives (`encrypt_bytes`,
  `decrypt_bytes`, `is_encrypted_data`) moved into `collab_core::crypto`;
  `src-tauri/src/crypto.rs` re-exports them (keeping Argon2 key derivation and
  the vault.enc password helpers) and `collab-replica` consumes them directly.
- Verified the whole extraction: `cargo check --workspace` is clean, the desktop
  lib (`109`), `collab-replica` (`18`), and `collab-core` (`42`) test suites all
  pass, and the shared crates plus the full `src-tauri` lib cross-compile for
  `aarch64-linux-android`, so the desktop client, standalone server, and Android
  companion all continue to build against the shared foundation.

Phase 1 is complete: hosted auth/session refresh, the hosted request/client
layer, refresh-token storage, and the offline replica store are all shared
between the desktop and Android clients through `hosted_client`,
`hosted_session`, `server_token_store`, and the `collab-replica` /
`collab-core::crypto` crates, with token storage kept platform-specific and
bearer tokens never entering the webview.

### Phase 2: Android Mobile Shell

Estimated effort: 2-4 weeks.

Goals:

- Add a mobile-specific React shell.
- Implement hosted login, saved server list, reconnect, and disconnect.
- Show hosted vault inventory per connected server.
- Add a mobile vault switcher.
- Add a phone-first file browser.
- Add settings for theme/accent/font scale where sensible.

Acceptance criteria:

- User can sign in to a hosted server and reopen the app without retyping a
  password while the refresh token is valid.
- User can select a hosted vault and browse its active files.
- Viewer-role users see read-only affordances.
- Navigation is ergonomic on a phone without desktop sidebars or tabs.

Current implementation notes:

- Replaced the Phase 0 probe screen with a real phone-first shell in
  `apps/mobile-android/src/`: a bottom tab bar (`Servers`, `Vaults`, `Files`,
  `Settings`) with drill-in navigation (`MobileApp.tsx`), deliberately not
  importing the desktop `AppShell`, sidebar, or tab model.
- The shell has its own lightweight state layer (`state/store.ts`, a Zustand
  store) and IPC layer (`mobileTauri.ts`) that reuse the existing shared native
  commands — `connect_server`, `reconnect_server`, `disconnect_server`,
  `server_connection_statuses`, `server_has_saved_session`, and the
  bearer-hidden `hosted_vault_request` gateway — so no new Rust commands were
  needed and access/refresh tokens still never enter the web view.
- `ServersScreen` implements hosted login (URL/username/password + optional
  untrusted-certificate opt-in), a saved-server list persisted in
  `lib/servers.ts` (`collab-mobile-servers`, mirroring the desktop
  `KnownServer` shape), per-server connect/reconnect/disconnect, and online
  status dots. On launch `store.restore()` reconnects every saved server that
  has a stored refresh token, so the app reopens without re-entering a password
  while the token is valid.
- `VaultsScreen` lists the hosted vault inventory per connected server with
  storage/member/role metadata and acts as the vault switcher; `FilesScreen` is
  a phone-first browser (folder drill-in with breadcrumbs) over
  `GET /api/v1/vaults/{id}/files`, with a read-only detail sheet. Viewer-role
  vaults show a shared `Read only` badge on both the vault row and the file
  browser header, and no edit affordances are presented (editing lands in
  Phases 4–5).
- `SettingsScreen` exposes theme, accent color, and text-size controls backed by
  `lib/theme.ts`, which mirrors the desktop theme/accent tokens and applies them
  as CSS custom properties so the companion shares the desktop visual language;
  preferences persist in `collab-mobile-theme`.
- Verification: `pnpm mobile:build` (tsc + Vite) is clean and a new
  `pnpm mobile:test` Vitest suite (7 tests, `apps/mobile-android/vitest.config.ts`)
  covers the format/file-tree helpers and a shell render smoke test (login form
  + bottom nav when no servers are saved; refresh-token session restore that
  lists vaults and surfaces the viewer read-only affordance). On-device/emulator
  QA across a device matrix is deferred to Phase 7.

### Phase 3: Offline Replica Read Path

Estimated effort: 3-5 weeks.

Goals:

- Let users mark a hosted vault for offline availability.
- Seed and update the Android replica from the hosted manifest.
- Cache note/Kanban document content.
- Cache required asset bytes for images and PDFs when opened or explicitly saved
  offline.
- Support opening already-cached vaults without network.
- Add sync-status surfaces and pending-operation summaries.

Acceptance criteria:

- A seeded vault can be opened in airplane mode.
- Cached notes and Kanban boards load offline.
- File browser clearly distinguishes cached, not-yet-cached, syncing, and failed
  states.
- Removing an offline copy removes app-local replica data after confirmation.

### Phase 4: Notes MVP

Estimated effort: 4-6 weeks.

Goals:

- Build a mobile note viewer.
- Build a mobile markdown editor.
- Reuse markdown rendering where practical.
- Add a compact mobile toolbar for common markdown actions.
- Save online through hosted document writes.
- Queue offline writes through the replica operation model.
- Preserve dirty/offline/conflict status in the document screen.

Acceptance criteria:

- User can open, edit, save, close, and reopen a note.
- Offline note edits remain visible after app restart.
- Offline edits sync when the server connection returns.
- Hosted viewer-role users cannot edit.
- Conflict or failed-sync states are visible and recoverable.

Implementation note:

CodeMirror should be tested early on Android. If keyboard/selection behavior is
poor, use a simpler textarea-based editor for the MVP and reserve CodeMirror for
later.

### Phase 5: Kanban MVP

Estimated effort: 3-5 weeks.

Goals:

- Build a mobile-first Kanban board view.
- Prefer column drill-in and card detail screens over desktop-style wide boards.
- Support card title, description, status/column, checklist, tags, due dates, and
  comments if already represented in the document schema.
- Support online save and offline queued mutation.
- Keep drag-and-drop optional; buttons/menus are acceptable for v1.

Acceptance criteria:

- User can view boards on a phone without horizontal desktop-board dependence.
- User can create/edit/move cards with touch-friendly controls.
- Offline card edits queue and sync.
- Viewer-role users cannot mutate boards.

### Phase 6: Viewer-Only Rich Files

Estimated effort: 3-6 weeks.

Goals:

- Add image viewer with pinch/zoom/pan and cached asset reads.
- Add PDF viewer with basic page navigation and zoom.
- Add canvas viewer using a read-only, pan/zoom-friendly renderer.
- Add logic diagram viewer using the existing source/export rendering concepts.
- Avoid edit controls for these file types in the initial mobile product.

Acceptance criteria:

- PDFs, images, canvases, and logic diagrams can be opened from the mobile file
  browser.
- Viewers work with cached content where available.
- Unsupported or uncached files fail clearly rather than pretending to be synced.
- No viewer exposes edit/save actions in the MVP.

### Phase 7: Android Hardening And Release Prep

Estimated effort: 4-8 weeks.

Goals:

- Test app lifecycle: foreground, background, kill, restart, network loss,
  airplane mode, and device sleep.
- Add Android signing/release build documentation.
- Add basic crash/error logging strategy.
- Validate hosted TLS/session behavior against public reverse proxies.
- Add device matrix testing for small/large phones and tablets.
- Add release checklist and user-facing limitations.

Acceptance criteria:

- Android release build can be produced reproducibly.
- Manual QA checklist covers login, offline open, offline edit, sync recovery,
  viewer files, and permission boundaries.
- Known limitations are documented.
- The app is safe to distribute to a small internal/beta group.

### Phase 8: Later Expansion

Deferred until the Android MVP proves useful.

Candidates:

- Live CRDT editing for notes and Kanban.
- Push notifications for mentions/activity.
- Android background sync with OS constraints respected.
- iOS feasibility and build pipeline.
- Better PDF search/annotations.
- Lightweight canvas or logic editing, only if mobile usage justifies it.
- Mobile capture flows such as quick note, share-to-vault, and camera/image
  upload.

## Major Risks

- **Tauri mobile maturity:** the spike must prove the exact primitives Collab
  needs, not just that a demo app runs.
- **Mobile editor ergonomics:** markdown editing is only useful if keyboard,
  selection, toolbar, and scrolling behave well on real devices.
- **Offline correctness:** queued operations and conflict states must remain
  boring and reliable; this is more important than feature count.
- **Background sync limits:** Android may delay or stop background work. The MVP
  should sync on foreground and explicit user action first.
- **Large file performance:** PDFs, canvases, and images may need mobile-specific
  render limits.
- **Code sharing pressure:** sharing business logic is good; sharing desktop UI
  layout is not.

## Recommended Implementation Order

1. Land Phase 0 as a spike branch and record the result in this document.
2. If Tauri mobile is viable, extract shared Rust client/replica crates before
   building feature UI.
3. Build Android shell and server/vault access.
4. Implement offline read-only vault browsing.
5. Add note editing.
6. Add Kanban editing.
7. Add viewer-only rich files.
8. Harden for beta distribution.

## Definition Of A Useful MVP

The mobile companion is useful when a hosted-vault user can:

1. Open the Android app without re-entering credentials.
2. Open a hosted vault.
3. Read notes and Kanban boards offline.
4. Edit a note offline.
5. Edit a Kanban card offline.
6. Reconnect and sync those edits without manual recovery in the normal case.
7. Open PDFs, images, canvases, and logic diagrams as read-only references.

Anything beyond that should wait until the companion workflow is proven in real
daily use.
