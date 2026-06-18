#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: COLLAB_RESTORE_CONFIRM=restore ./scripts/server-restore.sh <backup-dir-or-name>" >&2
  exit 64
fi

if [[ "${COLLAB_RESTORE_CONFIRM:-}" != "restore" ]]; then
  echo "Refusing destructive restore. Set COLLAB_RESTORE_CONFIRM=restore." >&2
  exit 65
fi

backup_dir="$1"
compose=(docker compose)

"${compose[@]}" stop gateway collab-server backup >/dev/null 2>&1 || true
"${compose[@]}" run --rm restore /usr/local/bin/collab-restore "${backup_dir}"

if [[ "${COLLAB_RESTORE_NO_RESTART:-}" != "1" ]]; then
  "${compose[@]}" up -d --wait postgres collab-server gateway
fi
