#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose)

usage() {
  cat <<'EOF'
Usage: ./scripts/server-backups.sh <command> [args]

Simple commands:
  backup                 Run one backup now
  schedule               Start the scheduled backup worker
  stop-schedule          Stop the scheduled backup worker
  list                   List available backups
  verify <backup-name>   Verify checksums for one backup
  restore <backup-name>  Restore one backup, with an interactive confirmation
  upgrade-preflight      Create+verify a backup and capture migration state
  smoke-test             Run the isolated backup/restore smoke test

Custom operator commands remain available:
  ./scripts/server-backup.sh
  COLLAB_RESTORE_CONFIRM=restore ./scripts/server-restore.sh <backup-name>

Useful environment variables:
  COLLAB_BACKUP_INTERVAL_SECONDS=86400
  COLLAB_BACKUP_RETENTION_DAYS=14
  COLLAB_RESTORE_NO_RESTART=1
EOF
}

require_backup_name() {
  if [[ $# -ne 1 ]]; then
    echo "Expected exactly one backup name." >&2
    usage >&2
    exit 64
  fi

  case "$1" in
    collab-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;;
    *)
      echo "Unsafe backup name: $1" >&2
      echo "Expected a name like collab-backup-20260618T111501Z." >&2
      exit 64
      ;;
  esac
}

list_backups() {
  "${compose[@]}" run --rm backup /bin/sh -eu -c '
    set -- /backups/collab-backup-*
    if [ ! -d "$1" ]; then
      echo "No backups found." >&2
      exit 0
    fi
    for dir do
      [ -d "$dir" ] && basename "$dir"
    done | sort
  '
}

verify_backup() {
  local backup_name="$1"
  "${compose[@]}" run --rm backup /bin/sh -eu -c '
    cd "/backups/$1"
    sha256sum -c checksums.sha256
  ' sh "${backup_name}"
}

confirm_restore() {
  local backup_name="$1"

  if [[ "${COLLAB_RESTORE_CONFIRM:-}" == "restore" ]]; then
    return
  fi

  echo "This will replace the current PostgreSQL schema and blob storage with:"
  echo "  ${backup_name}"
  echo
  read -r -p "Type restore to continue: " answer
  if [[ "${answer}" != "restore" ]]; then
    echo "Restore cancelled." >&2
    exit 65
  fi
}

command="${1:-help}"
shift || true

case "${command}" in
  backup | now)
    if [[ $# -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    ./scripts/server-backup.sh
    ;;
  schedule | start-schedule)
    if [[ $# -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    "${compose[@]}" --profile backup up -d backup
    ;;
  stop-schedule)
    if [[ $# -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    "${compose[@]}" stop backup
    ;;
  list)
    if [[ $# -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    list_backups
    ;;
  verify)
    require_backup_name "$@"
    verify_backup "$1"
    ;;
  restore)
    require_backup_name "$@"
    confirm_restore "$1"
    COLLAB_RESTORE_CONFIRM=restore ./scripts/server-restore.sh "$1"
    ;;
  upgrade-preflight | preflight)
    if [[ $# -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    ./scripts/server-upgrade-preflight.sh
    ;;
  smoke-test)
    if [[ $# -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    ./scripts/server-backup-restore-smoke.sh
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    echo "Unknown backup command: ${command}" >&2
    usage >&2
    exit 64
    ;;
esac
