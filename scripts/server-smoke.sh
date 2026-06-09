#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose)

cleanup() {
  "${compose[@]}" down --remove-orphans
}
trap cleanup EXIT

"${compose[@]}" up --build --wait
curl --fail --silent http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/health/live
curl --fail --silent http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/health/ready
docker compose exec -T collab-server sh -c 'test -w /data/blobs && test -w /backups'
