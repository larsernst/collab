# collab

Local-first vault-based knowledge work for Markdown notes, canvases, Kanban boards,
PDFs, images, and collaboration.

`collab` is a Tauri 2 desktop app built with React 19, TypeScript, Rust, and
CodeMirror 6. Local vaults remain first-class and stay on disk. Existing
shared-folder collaboration works through vault metadata, while a self-hosted
collaboration server is being built for authenticated users, hosted vaults,
server-backed permissions, and future live/offline synchronization.

The server foundation plus authentication and administration phases are
complete. They include PostgreSQL-backed identities, Argon2id credentials,
secure browser and native sessions, expiring invitations, audit events, a
Collab-style admin web interface, and a minimal desktop server connection flow.

## Highlights

- Markdown notes with live preview, wikilinks, backlinks, autosave, optimistic conflict handling, and rich insertion tools
- First-class vault files for `.md`, `.canvas`, `.kanban`, images, and PDFs
- Canvas boards with note/file/text/web cards, edge labels/styles/arrows, PDF thumbnails, and link previews/embeds
- Kanban boards with drag-and-drop columns/cards, calendar and timeline views, attachments, assignees, tags, archive, and templates
- Dedicated PDF reader with single-page, long-scroll, and side-by-side layouts plus fit and custom zoom modes
- Dedicated image viewer/editor with additive annotation overlays and permanent crop/rotate/resize/export flows
- Shared-folder collaboration with presence, chat, per-file history snapshots, permissions, and conflict dialogs
- Self-hosted Docker Compose server foundation with PostgreSQL, persistent blob storage, Caddy, health checks, and migrations
- Server administration web interface with first-admin bootstrap, invitations, dashboard, user/password/session lifecycle management, activity inspection, and audit views
- Vault encryption with Argon2id + AES-256-GCM
- Theming, font, motion, calendar, zoom, and web preview settings
- Native desktop packaging through Tauri, including Flatpak support and in-app updates where supported

## Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri 2 |
| Frontend | React 19, Vite, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui, Radix UI |
| Editor | CodeMirror 6 |
| Canvas | `@xyflow/react` |
| Kanban drag/drop | `dnd-kit` |
| Graph view | D3 |
| PDF rendering | `pdfjs-dist` |
| State | Zustand |
| Desktop backend | Rust, Tauri commands |
| Collaboration server | Rust, Axum, SQLx, PostgreSQL |
| Admin web | React 19, Vite |
| Deployment | Docker Compose, Caddy |

## Current Features

### Notes

- CodeMirror-based Markdown editing with GFM support
- Live inline formatting previews for common Markdown constructs
- Wikilinks with vault-wide autocomplete and backlink indexing
- Autosave with optimistic locking and conflict resolution
- Auto-rename to match the first H1 heading
- Toolbar actions for headings, formatting, links, images, tables, task lists, math, code blocks, and more
- Shift-click editor dialogs for visual table, task-list, math-block, and fenced-code editing
- Nerd Font icon picker and command-bar insertion actions
- Sidebar search and tag browsing

### Vault Files And Views

- Notes (`.md`)
- Canvases (`.canvas`)
- Kanban boards (`.kanban`)
- Images, including additive overlay annotations stored under `.collab/image-overlays/`
- PDFs opened in a custom in-app reader
- Multi-tab editing with dirty-state tracking and drag-reorder
- Grid workspace view for arranging multiple views side by side

### Navigation And Discovery

- D3 graph view for wikilink relationships across notes
- File tree with folders, managed media, drag-and-drop moves, and context actions
- Command bar for search, quick actions, note creation, math evaluation, and editor insertions
- Vault-wide text search and tag browsing in the sidebar
- Shared document top-bar pattern across note, image, PDF, canvas, and Kanban views

### Canvas

- Node types: note, file, text, and web
- Drag files from the file tree onto the canvas
- Rich card previews for notes, text-like files, images, PDFs, and websites
- Web cards with preview/embed modes, optional auto-load, and global preview controls
- Styled edges with labels, solid/dashed/dotted lines, animation, and start/end arrows
- Viewport persistence and optimistic save/reload handling

### Kanban

- Multi-column drag-and-drop boards
- Card attachments to vault files
- Assignees, tags, checklists, due-date oriented views, and archived cards
- Calendar and timeline views
- Default column tags and optional auto-apply-on-move behavior
- Built-in, vault, and app-level Kanban templates
- Import/export/copy/apply template flows

### PDFs And Images

- PDF reader with single, scroll, and spread layouts
- Fit-width, fit-height, fit-page, `100%`, and custom zoom controls
- Rotation and keyboard shortcut support in the PDF viewer
- Image viewer with additive annotations like pen, arrows, text, crop overlays, and erasing
- Permanent image edits for crop, rotate, resize, flattening, overwrite, or save-as-new-image

### Collaboration

- Presence stored in `{vault}/.collab/presence/`
- Active-file awareness and peer presence in the UI
- Sidebar collaboration panel with peers, chat, and history tabs
- Typing indicators in chat
- Snapshots stored under `{vault}/.collab/snapshots/` with compare and restore flows
- Vault member roles: viewer, editor, admin
- Conflict dialogs for concurrent edits

### Self-Hosted Server And Administration

- Standalone Rust collaboration server with structured configuration and logging
- Docker Compose stack containing PostgreSQL, the collaboration server, and Caddy
- Persistent PostgreSQL, blob-storage, backup, and gateway volumes
- Liveness and readiness endpoints plus automatic SQL migrations
- Content-addressed filesystem blob storage behind a storage abstraction
- PostgreSQL-backed users, credentials, browser/native sessions, invitations, and audit events
- Canonical hosted-vault and membership storage with authenticated lifecycle,
  role-management, activity, and administration inventory APIs
- Stable-ID hosted file manifests, portable hosted-path validation, and
  optimistic text-document revisions backed by content-addressed blobs
- Argon2id password hashing, one-time administrator bootstrap, CSRF protection, and login rate limiting
- Collab-style admin web interface served at `/admin/`
- Dashboard storage/warning summaries, user creation/invitations, password reset, disable/re-enable/delete controls, session revocation, activity inspection, and redacted audit views
- Desktop server login in Settings with memory-only access tokens and refresh tokens stored in the OS credential store

Hosted binary assets, structural file operations, and live/offline
synchronization remain under active development. Progress is tracked in
[COLLAB_SERVER_PLAN.md](./COLLAB_SERVER_PLAN.md).

### Vault Management And Security

- Create, open, rename, export, and switch vaults
- Recent vault history with validation/pruning of missing paths
- AES-256-GCM vault encryption with Argon2id-derived keys
- Unlock, enable, disable, and change-password flows
- App-managed `Pictures/` folder for imported image assets

### UI And Customization

- Themes: `dark`, `midnight`, `warm`, `light`
- Accent colors: `violet`, `blue`, `emerald`, `rose`, `orange`, `cyan`
- Interface fonts: `geist`, `inter`, `serif`, `mono`
- Editor fonts: `codingMono`, `jetbrainsMono`, `firaCode`
- Separate interface/editor font sizes
- UI scale controls
- Animation and motion controls
- Date format and week-start settings
- Web preview and hover-preview toggles
- In-app shortcuts reference and command bar

## Project Structure

```text
apps/
  admin-web/         Focused browser administration interface

crates/
  collab-core/       Shared hashing and relative-path rules
  collab-protocol/   Shared server DTOs, error codes, and protocol versions
  collab-server/     Axum server, authentication, migrations, and blob storage

src/
  components/
    collaboration/   Presence, chat, history, conflict UI
    command-bar/     Global command/search/action palette
    editor/          Markdown editor, toolbar, preview helpers, editor dialogs
    graph/           D3 graph view
    grid/            Multi-workspace layout UI
    kanban/          Board, columns, cards, templates, calendar, timeline
    layout/          App shell, activity bar, sidebar, tab bar, status bar
    previews/        Web preview popovers
    settings/        Settings and shortcuts UI
    ui/              shadcn/ui primitives
    vault/           Vault picker, file tree, boards panel, dialogs
  lib/
    tauri.ts         Typed Tauri IPC wrappers
    collabTransport.ts
  store/
    vaultStore.ts
    editorStore.ts
    uiStore.ts
    noteIndexStore.ts
    collabStore.ts
    gridStore.ts
    kanbanStore.ts
    updateStore.ts
  types/
    canvas.ts
    kanban.ts
    image.ts
    note.ts
    template.ts
    vault.ts
  views/
    NoteView.tsx
    ImageView.tsx
    PdfView.tsx
    GraphPage.tsx
    CanvasPage.tsx
    KanbanPage.tsx
    GridView.tsx
    SettingsPage.tsx

src-tauri/src/commands/
  vault.rs
  files.rs
  templates.rs
  index.rs
  watcher.rs
  collab.rs
  crypto.rs
  ui.rs
  update.rs
  web.rs
  server.rs

compose.yaml          Local server/PostgreSQL/Caddy stack
Dockerfile.server     Cached multi-stage server and admin-web image
```

## Requirements

- Node.js 20+
- `pnpm` 10+
- Rust stable toolchain
- Tauri 2 system dependencies for your platform
- Docker with Docker Compose for the collaboration server
- `curl` for server smoke tests

Linux packaging and install notes live in
[docs/linux-install.md](./docs/linux-install.md).

## Build Instructions

Install JavaScript dependencies once:

```bash
pnpm install
```

### Desktop App

Run the complete desktop app in development:

```bash
pnpm tauri dev
```

Build a production desktop bundle:

```bash
pnpm tauri build
```

Run only the browser frontend without the Tauri shell:

```bash
pnpm dev
```

### Admin Web Interface

Run the focused server administration interface locally:

```bash
pnpm admin:dev
```

Build and type-check its production bundle:

```bash
pnpm admin:build
```

The development server proxies API requests to a collaboration server listening
on `127.0.0.1:8787`.

### Collaboration Server With Docker Compose

Start PostgreSQL, the collaboration server, and Caddy:

```bash
docker compose up --build --wait
```

The local gateway listens on `http://127.0.0.1:8788`:

- Admin interface: `http://127.0.0.1:8788/admin/`
- Liveness: `http://127.0.0.1:8788/health/live`
- Readiness: `http://127.0.0.1:8788/health/ready`

Stop the containers while preserving data:

```bash
docker compose down
```

Delete the development containers and their persistent volumes:

```bash
docker compose down --volumes
```

The server image uses `cargo-chef` to cache Rust dependencies, and the admin-web
image stage caches JavaScript dependency installation separately from source
changes.

### Flatpak

Build the local Flatpak package:

```bash
./flatpak/build-local.sh
```

### Verification

Run the full project verification set:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm admin:test
pnpm admin:build
cargo test --workspace
cargo check --workspace
docker compose config
./scripts/server-smoke.sh
```

The live PostgreSQL server tests require a disposable database:

```bash
COLLAB_TEST_DATABASE_URL=postgres://collab:password@127.0.0.1:5432/collab_test \
  cargo test -p collab-server
```

The authentication lifecycle test truncates the Phase 2 identity tables, so do
not point it at a database containing valuable data.

## Useful Documents

### Project And Contribution Guides

- [CODEBASE.md](./CODEBASE.md) - detailed architecture, component, IPC, and feature map
- [UI_GUIDE.md](./UI_GUIDE.md) - visual language and interaction patterns
- [REMAINING_STABILIZATION_STEPS.md](./REMAINING_STABILIZATION_STEPS.md) - outstanding stabilization work

### Collaboration Server

- [COLLAB_SERVER_PLAN.md](./COLLAB_SERVER_PLAN.md) - phased server implementation tracker
- [Server architecture index](./docs/server/README.md) - entry point for server architecture documents
- [Server development and Compose](./docs/server/development.md) - local operation, configuration, and verification
- [Admin web interface](./docs/server/admin-web.md) - scope, security model, and testing expectations
- [REST and WebSocket protocol](./docs/server/protocol.md) - versioned API and synchronization contracts
- [Hosted vault domain model](./docs/server/hosted-vault-domain.md) - identities, permissions, revisions, and vault structure
- [Security, operations, and compatibility](./docs/server/security-operations.md) - threat model, migrations, secrets, and backups
- [Workspace and verification](./docs/server/workspace-verification.md) - crate boundaries and acceptance checks

### Packaging And Installation

- [Linux installation](./docs/linux-install.md)
- [Flatpak guide](./docs/flatpak.md)
- [Flatpak distribution plan](./docs/flatpak-distribution-plan.md)

## Notes For Contributors

- Frontend code should go through typed wrappers in `src/lib/tauri.ts` instead of calling Tauri plugins directly from components
- Paths crossing the IPC boundary are relative to the vault root
- Normal file listing/indexing excludes `.collab/` and generated dependency/build directories
- `write_note` uses optimistic locking via `expected_hash`
- Shared document-style viewers should follow the `DocumentTopBar` pattern
