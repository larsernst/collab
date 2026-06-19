# Collaboration Server Development

## Prerequisites

- Rust stable
- Docker with Docker Compose
- `curl`

## Run With Docker Compose

Copy `.env.example` to `.env` and replace the development database password
before exposing the stack beyond localhost. The gateway binds to all host
interfaces by default so it can be reached from another machine.

```bash
docker compose up --build --wait
curl http://127.0.0.1:8788/health/live
curl http://127.0.0.1:8788/health/ready
```

The gateway listens on `0.0.0.0:8788` by default. Set
`COLLAB_HTTP_BIND=127.0.0.1` for a local-only or external-reverse-proxy
deployment. PostgreSQL is not published to the host.
The administration interface is available at `http://<server-address>:8788/`;
the root path redirects to `/admin/`.
On a fresh database it opens the one-time first-administrator bootstrap flow.

Do not expose the default plain-HTTP development gateway directly to the
internet. Terminate TLS in front of it and set
`COLLAB_BROWSER_SECURE_COOKIES=true`.

The server image uses `cargo-chef` to keep compiled Rust dependencies in a
separate Docker layer. Normal source changes rebuild the application crate but
reuse the dependency layer. Changes to Cargo manifests or `Cargo.lock`
intentionally rebuild dependencies.

Persistent named volumes:

- `postgres-data`: PostgreSQL database
- `blob-data`: content-addressed file blobs
- `backups`: database and blob backup artifacts
- `caddy-data` and `caddy-config`: gateway state

Start the optional automated backup worker:

```bash
pnpm server:backup:schedule
```

Equivalent Compose command:

```bash
docker compose --profile backup up -d backup
```

Run one backup immediately:

```bash
pnpm server:backup
```

Equivalent script:

```bash
./scripts/server-backup.sh
```

Restore a backup into the Compose deployment:

```bash
pnpm server:restore collab-backup-YYYYMMDDTHHMMSSZ
```

The simple command prompts for confirmation. For non-interactive operator
flows, keep using the lower-level script:

```bash
COLLAB_RESTORE_CONFIRM=restore ./scripts/server-restore.sh collab-backup-YYYYMMDDTHHMMSSZ
```

Backups are written to the `backups` volume. See
[Server backups](./backups.md) for artifact layout, schedule, retention, and
restore procedures.

The default Compose deployment also enables the admin web Backups page to run
and restore backups. Set `COLLAB_BACKUP_COMMAND=` and
`COLLAB_RESTORE_COMMAND=` in `.env` to disable those buttons while keeping
listing, verification, and deletion available.

The Backups page can configure the built-in scheduler and container export path
directly. `.env` values are used as initial defaults before GUI-managed backup
settings are saved. For external storage, mount the target on the host and pass
it into Compose:

```dotenv
COLLAB_BACKUP_EXPORT_PATH=/mnt/collab-backups
```

Mount SMB/NFS/USB storage on the host first, then point
`COLLAB_BACKUP_EXPORT_PATH` at that mounted path. In the admin UI, use
`/backup-export` as the container export path.

Stop containers without deleting data:

```bash
docker compose down
```

Delete all development server data:

```bash
docker compose down --volumes
```

## Run The Server Against A Local PostgreSQL

```bash
export COLLAB_DATABASE_URL=postgres://collab:collab@127.0.0.1:5432/collab
export COLLAB_BLOB_DIR=server-data/blobs
cargo run -p collab-server
```

Configuration can also be read from a JSON file selected by `COLLAB_CONFIG_FILE`. Environment variables override file values.

Supported environment variables:

- `COLLAB_CONFIG_FILE`
- `COLLAB_HTTP_BIND`: host interface used by the Compose gateway
- `COLLAB_HTTP_PORT`: host port used by the Compose gateway
- `COLLAB_HOST`
- `COLLAB_PORT`
- `COLLAB_DATABASE_URL`
- `COLLAB_BLOB_DIR`
- `COLLAB_ADMIN_WEB_DIR`
- `COLLAB_BROWSER_SECURE_COOKIES`: use `true` behind production HTTPS
- `COLLAB_SESSION_TTL_HOURS`
- `COLLAB_NATIVE_ACCESS_TTL_MINUTES`
- `COLLAB_NATIVE_REFRESH_TTL_DAYS`
- `COLLAB_WS_TICKET_TTL_SECONDS`
All `*_BYTES` settings below accept either a plain integer or a human-readable
binary size with a unit suffix (`256MiB`, `12 GiB`, `1.5GiB`, `512k`); suffixes
are 1024-based and case-insensitive. The same string forms are accepted by the
`/admin/settings` byte fields, which display and round-trip the binary units.

- `COLLAB_MAX_FILE_BYTES`: maximum decoded size for one hosted file.
- `COLLAB_MAX_IMPORT_BYTES`: maximum compressed ZIP import size.
- `COLLAB_MAX_IMPORT_EXPANDED_BYTES`: maximum total expanded ZIP content.
- `COLLAB_STORAGE_WARNING_BYTES`: dashboard storage-pressure threshold for
  combined PostgreSQL and blob usage; set to `0` to disable the warning.
- `COLLAB_STORAGE_QUOTA_BYTES`: hard server-wide storage quota enforced against
  total deduplicated stored content (sum of unique blob sizes). Content-growing
  operations (asset uploads, text document writes, document creation, and ZIP
  imports) are rejected with `413`/`507 QUOTA_EXCEEDED` once the quota would be
  crossed. Set to `0` (the default) for no quota.
- `COLLAB_BACKUP_INTERVAL_SECONDS`: interval for the optional Compose backup
  worker and the server-managed scheduler.
- `COLLAB_BACKUP_RETENTION_DAYS`: backup directories older than this are
  pruned by backup helpers; set to `0` to disable pruning.
- `COLLAB_BACKUP_SCHEDULE_ENABLED`: enables the server-managed backup
  scheduler when `true`.
- `COLLAB_BACKUP_EXPORT_PATH`: optional Docker host path mounted into the
  server and backup containers for external backup copies.
- `COLLAB_BACKUP_EXPORT_DIR`: optional container path for external backup
  copies; use `/backup-export` with the default Compose mount.
- `COLLAB_BACKUP_COMMAND`: optional server-admin UI command hook for running a
  backup. Leave empty unless the container has been explicitly granted a safe
  orchestration path.
- `COLLAB_RESTORE_COMMAND`: optional server-admin UI command hook for restoring
  the backup named in `COLLAB_RESTORE_BACKUP`. Leave empty unless the restore
  workflow is handled by a trusted operator-controlled wrapper.

The server automatically allows the larger JSON request body required by
base64 encoding. The current ZIP importer validates in memory, so operators
should size these limits according to available container memory. A future
streaming/staged importer is required before enabling multi-gigabyte compressed
archives.
- `COLLAB_LOG`
- `COLLAB_LOG_FORMAT`: `pretty` or `json`

Runtime security, session, upload/import, storage-warning, and backup schedule
settings are configurable from `/admin/settings`. If one of the matching
`COLLAB_*` variables is present in `.env` or the container environment, it is
treated as a global override and the admin UI shows that field as locked.

## Verification

```bash
cargo test --workspace
cargo check --workspace
pnpm test
pnpm exec tsc --noEmit
pnpm admin:test
pnpm admin:build
docker compose config
./scripts/server-smoke.sh
./scripts/server-backup-restore-smoke.sh
```

PostgreSQL migration tests run when `COLLAB_TEST_DATABASE_URL` is set:

```bash
COLLAB_TEST_DATABASE_URL=postgres://collab:collab@127.0.0.1:5432/collab_test \
  cargo test -p collab-server
```

The live database test covers migration idempotency plus browser bootstrap,
invitations, login, password reset, disable/re-enable/delete protection,
administrator authorization, CSRF, hosted text revisions, binary asset
integrity/deduplication, structural operation ordering/authorization, native
login and refresh rotation/reuse detection, expired and forged tokens,
disabled-user behavior, and session revocation. Use a disposable test database
because the lifecycle test truncates the Phase 2 identity tables before running.

## Health Endpoints

- `/health/live` confirms the process can serve requests.
- `/health/ready` confirms PostgreSQL and blob storage are writable.

Every response includes `x-request-id`. A valid caller-provided request ID is preserved; otherwise the server generates a UUIDv7 request ID.
