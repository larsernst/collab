# Security Advisory Tracking

This document tracks every dependency security advisory that the project's
automated scans currently surface but that is **not yet resolved by an upgrade**,
along with the reasoning for each accepted risk. It is the human-readable
companion to the machine-readable ignore list in
[`.cargo/audit.toml`](../.cargo/audit.toml): every advisory ignored there must
have a corresponding entry here explaining *why* and *what would let us drop the
ignore*.

Keep the two in sync. When you add or remove an entry in `.cargo/audit.toml`,
update the matching row below in the same change.

## How scanning works

The `Security Scan` workflow (`.github/workflows/security-scan.yml`) runs:

- `cargo audit` over the Rust workspace lockfile, honoring the ignore list in
  `.cargo/audit.toml`. A **vulnerability** fails the job (exit 1);
  **informational** advisories (`unsound`, `yanked`) are reported as
  non-failing warnings.
- `pnpm audit --audit-level high` over the JavaScript dependencies.
- Trivy over the built server container image (`HIGH`/`CRITICAL`, fixable only).

Prefer fixing an advisory with a dependency upgrade. Only add an ignore when
there is genuinely no upgrade path (the fix is unreleased, or a pinned upstream
crate blocks it) **and** the vulnerable code path is not reachable in a way that
matters for this project.

## Accepted (ignored) advisories

These are the advisories currently listed in `ignore = [...]` in
`.cargo/audit.toml`. They fail the scan unless ignored, so each one is an
explicit, documented risk acceptance.

### RUSTSEC-2023-0071 — `rsa` 0.9.10 (Marvin timing side-channel)

- **Severity:** 5.9 (medium). Potential RSA private-key recovery via a timing
  side channel (Marvin attack).
- **Dependency path:** `rsa` is pulled in only through `sqlx-mysql`.
- **Why it is not reachable here:** `sqlx-macros-core` resolves every database
  backend for its compile-time macros, but collab-server enables the PostgreSQL
  backend only. The vulnerable `rsa` code is reachable solely through the MySQL
  backend, which is not compiled into the server binary. The desktop app does
  not depend on `rsa` at all.
- **Why it is not fixed:** there is no fixed **stable** `rsa` release. The fix
  landed only in `0.10.0-rc.*` prereleases; the latest stable remains `0.9.10`.
- **Remove the ignore when:** a stable `rsa` release (>= 0.10.0) is published and
  `sqlx` depends on it — or `sqlx` stops pulling `rsa` into the resolved graph
  for the PostgreSQL-only build.

### RUSTSEC-2026-0194 — `quick-xml` 0.38.4 (quadratic-time attribute parsing)

- **Severity:** 7.5 (high). Quadratic run time when checking a start tag for
  duplicate attribute names — a denial-of-service risk when parsing
  attacker-controlled XML.
- **Dependency path:** `quick-xml` is pulled in only through `plist`, which Tauri
  uses for macOS `Info.plist` parsing during bundling.
- **Why it is not reachable here:** the project never parses untrusted,
  attacker-controlled XML through `plist`/`quick-xml`. The usage is build-time,
  macOS-bundling tooling over first-party property lists.
- **Why it is not fixed:** the fix is `quick-xml` >= 0.41.0, but `plist`
  (including the latest `1.9.0`) constrains `quick-xml` to `^0.39`, so no
  lockfile update can reach 0.41. Tauri requires `plist = "^1"`, so we cannot
  bypass `plist`.
- **Remove the ignore when:** `plist` releases a version that depends on
  `quick-xml` >= 0.41.0 (and Tauri picks it up).

## Informational warnings (non-failing)

`cargo audit` also reports `unsound` and `yanked` advisories as warnings. They do
not fail CI, but we still resolve them when an upgrade exists.

- **RUSTSEC-2026-0097 — `rand` (`unsound`).** The workspace resolves three `rand`
  versions; the advisory is fixed in `>= 0.8.6` / `>= 0.9.3` / `>= 0.10.1`.
  - `rand` 0.8.5 was bumped to **0.8.6** (now patched), and the workspace's
    `rand` 0.9.4 is already in the patched range.
  - `rand` **0.7.3** still remains via `phf_generator` 0.8.0 →
    `kuchikiki`/`selectors` → `tauri-utils` (Tauri's build-time HTML parsing
    tooling). It is pinned by `phf_generator 0.8.0`'s `rand = "^0.7"`
    requirement, so it cannot be upgraded independently and there is no patched
    0.7 release. This is a build-time-only warning that does not exercise the
    affected custom-logger + `thread_rng` reseed pattern; it clears once the
    upstream Tauri build tooling moves to a newer `phf`.
- **`unicode-segmentation` `yanked`.** Bumped from the yanked `1.13.1` to
  **1.13.3**.

## Review cadence

Re-check these entries whenever Tauri, `sqlx`, or `plist` are upgraded, and at
minimum before each tagged release. Drop any ignore whose upstream fix has
shipped, and delete the corresponding row here.

_Last reviewed: 2026-07-02._
