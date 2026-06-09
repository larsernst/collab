# Collaboration Server Development

## Prerequisites

- Rust stable
- Docker with Docker Compose
- `curl`

## Run With Docker Compose

Copy `.env.example` to `.env` and replace the development database password before exposing the stack beyond localhost.

```bash
docker compose up --build --wait
curl http://127.0.0.1:8788/health/live
curl http://127.0.0.1:8788/health/ready
```

The gateway listens on `127.0.0.1:8788` by default. PostgreSQL is not published to the host.

The server image uses `cargo-chef` to keep compiled Rust dependencies in a
separate Docker layer. Normal source changes rebuild the application crate but
reuse the dependency layer. Changes to Cargo manifests or `Cargo.lock`
intentionally rebuild dependencies.

Persistent named volumes:

- `postgres-data`: PostgreSQL database
- `blob-data`: content-addressed file blobs
- `backups`: future database and blob backups
- `caddy-data` and `caddy-config`: gateway state

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
- `COLLAB_HOST`
- `COLLAB_PORT`
- `COLLAB_DATABASE_URL`
- `COLLAB_BLOB_DIR`
- `COLLAB_LOG`
- `COLLAB_LOG_FORMAT`: `pretty` or `json`

## Verification

```bash
cargo test --workspace
cargo check --workspace
pnpm test
pnpm exec tsc --noEmit
docker compose config
./scripts/server-smoke.sh
```

PostgreSQL migration tests run when `COLLAB_TEST_DATABASE_URL` is set:

```bash
COLLAB_TEST_DATABASE_URL=postgres://collab:collab@127.0.0.1:5432/collab_test \
  cargo test -p collab-server database::tests
```

## Health Endpoints

- `/health/live` confirms the process can serve requests.
- `/health/ready` confirms PostgreSQL and blob storage are writable.

Every response includes `x-request-id`. A valid caller-provided request ID is preserved; otherwise the server generates a UUIDv7 request ID.
