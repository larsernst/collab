#!/usr/bin/env bash
set -euo pipefail

project="${COLLAB_RESTORE_SMOKE_PROJECT:-collab-restore-smoke}"

cleanup() {
  docker compose -p "$project" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
cleanup
trap cleanup EXIT

docker compose -p "$project" up -d --wait postgres >/dev/null

docker compose -p "$project" exec -T postgres psql -U collab -d collab -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE restore_probe (id integer PRIMARY KEY, value text NOT NULL); INSERT INTO restore_probe VALUES (1, 'before');" \
  >/dev/null

docker compose -p "$project" run --rm --no-deps -e COLLAB_RESTORE_CONFIRM=restore restore \
  /bin/sh -c 'mkdir -p /data/blobs/probe && printf blob-before > /data/blobs/probe/payload.txt' \
  >/dev/null

docker compose -p "$project" run --rm backup /usr/local/bin/collab-backup >/tmp/collab-restore-backup.out
backup_dir="$(sed -n 's/^Created backup //p' /tmp/collab-restore-backup.out | tail -n 1)"
if [[ -z "$backup_dir" ]]; then
  echo "Backup smoke test did not report a backup directory." >&2
  exit 1
fi

docker compose -p "$project" run --rm --no-deps backup /bin/sh -c \
  "cd '$backup_dir' && sha256sum -c checksums.sha256" \
  >/dev/null

docker compose -p "$project" exec -T postgres psql -U collab -d collab -v ON_ERROR_STOP=1 \
  -c "UPDATE restore_probe SET value = 'after';" \
  >/dev/null

docker compose -p "$project" run --rm --no-deps -e COLLAB_RESTORE_CONFIRM=restore restore \
  /bin/sh -c 'printf blob-after > /data/blobs/probe/payload.txt' \
  >/dev/null

docker compose -p "$project" run --rm -e COLLAB_RESTORE_CONFIRM=restore restore \
  /usr/local/bin/collab-restore "$backup_dir" \
  >/dev/null

value="$(docker compose -p "$project" exec -T postgres psql -U collab -d collab -tA -c "SELECT value FROM restore_probe WHERE id = 1;")"
blob="$(docker compose -p "$project" run --rm --no-deps restore /bin/sh -c 'cat /data/blobs/probe/payload.txt')"

test "$value" = before
test "$blob" = blob-before

echo "backup_restore_roundtrip=ok"
