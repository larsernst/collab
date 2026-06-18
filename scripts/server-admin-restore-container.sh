#!/bin/sh
set -eu

if [ -z "${COLLAB_RESTORE_BACKUP:-}" ]; then
  echo "COLLAB_RESTORE_BACKUP is required." >&2
  exit 64
fi

export COLLAB_RESTORE_CONFIRM=restore

/usr/local/bin/collab-restore "${COLLAB_RESTORE_BACKUP}"

nohup sh -c 'sleep 2; kill -TERM 1' >/dev/null 2>&1 &

echo "Restore completed. Restarting the Collab server container so it reconnects to the restored database."
