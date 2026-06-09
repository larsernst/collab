# Server Workspace and Verification

## Rust Workspace

The repository root is the Cargo workspace root:

```text
Cargo.toml
crates/
  collab-core/       Pure shared domain rules, path handling, formats, and reference logic
  collab-protocol/   Shared API/WebSocket DTOs, error codes, and protocol versions
  collab-server/     HTTP/WebSocket server, database, storage, auth, and migrations
src-tauri/           Tauri application adapter and native-only commands
```

Dependency direction:

```text
collab-protocol -> no application crates
collab-core     -> collab-protocol only when shared DTOs are required
collab-server   -> collab-core + collab-protocol
src-tauri       -> collab-core + collab-protocol
```

`collab-core` must not depend on Tauri, Axum, SQLx, PostgreSQL, or a concrete blob backend. Server authorization and persistence remain in `collab-server`.

## Extraction Policy

- Extract code only when both Tauri and server need the same behavior.
- Preserve existing Tauri command signatures until a frontend migration explicitly changes them.
- Move path normalization, file-format parsing, reference analysis/rewrites, hashing, and compatible import/export rules first.
- Do not move local-only dialogs, recent-vault persistence, watchers, updater logic, or encryption-session state into shared crates.
- Add characterization tests before moving high-risk existing behavior.

## Required Verification

Existing checks remain required:

```bash
pnpm test
pnpm exec tsc --noEmit
cd src-tauri && cargo test
cd src-tauri && cargo check
```

Phase 1 adds:

```bash
cargo test --workspace
cargo check --workspace
docker compose config
docker compose up --build --wait
./scripts/server-smoke.sh
```

`Dockerfile.server` uses `cargo-chef` to cache compiled dependencies separately
from application source. The first image build warms the cache. Later source-only
changes reuse the dependency layer; Cargo manifest and lockfile changes rebuild it.

The server crate must add:

- Unit tests for domain and authorization rules.
- PostgreSQL integration tests using isolated databases.
- REST and WebSocket protocol tests.
- Blob-storage contract tests.
- Migration tests from every supported schema fixture.
- Compose smoke tests from an empty environment.

## Change Acceptance

A server phase task is complete only when:

- Its behavior is implemented and tested.
- Existing local-vault behavior remains green.
- Relevant architecture and protocol documents are updated.
- `COLLAB_SERVER_PLAN.md` status, checkboxes, and progress log are updated.
