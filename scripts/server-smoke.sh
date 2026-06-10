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
curl --fail --silent http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/api/v1/auth/bootstrap-status
curl --fail --silent --location http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/ | grep --quiet "Collab Server Admin"
curl --fail --silent http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}/admin/ | grep --quiet "Collab Server Admin"
docker compose exec -T collab-server sh -c 'test -w /data/blobs && test -w /backups'
