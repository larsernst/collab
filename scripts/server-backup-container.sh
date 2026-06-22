#!/bin/sh
set -eu

backup_root="${COLLAB_BACKUP_DIR:-/backups}"
blob_dir="${COLLAB_BLOB_DIR:-/data/blobs}"
export_dir="${COLLAB_BACKUP_EXPORT_DIR:-}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_name="collab-backup-${timestamp}"
backup_dir="${backup_root}/${backup_name}"
work_dir="${backup_root}/.${backup_name}.tmp.$$"
retention_days="${COLLAB_BACKUP_RETENTION_DAYS:-14}"
tar_log="${work_dir}.tar.log"

cleanup_work_dir() {
  status="$?"
  if [ "${status}" -ne 0 ]; then
    rm -rf "${work_dir}"
  fi
  rm -f "${tar_log}"
}
trap cleanup_work_dir EXIT INT TERM

run_step() {
  label="$1"
  shift
  echo "backup_step=${label}"
  set +e
  "$@"
  status="$?"
  set -e
  if [ "${status}" -ne 0 ]; then
    echo "Backup step failed (${label}) with exit status ${status}." >&2
    return "${status}"
  fi
}

run_step prepare-backup-root mkdir -p "${backup_root}"
if [ -e "${backup_dir}" ] || [ -e "${work_dir}" ]; then
  echo "Backup target already exists: ${backup_dir}" >&2
  exit 68
fi
run_step prepare-work-dir mkdir -p "${work_dir}"

export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

run_step postgres-dump pg_dump \
  --host="${POSTGRES_HOST:-postgres}" \
  --port="${POSTGRES_PORT:-5432}" \
  --username="${POSTGRES_USER:?POSTGRES_USER is required}" \
  --dbname="${POSTGRES_DB:?POSTGRES_DB is required}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${work_dir}/postgres.dump"

if tar --help 2>/dev/null | grep -q -- '--ignore-failed-read'; then
  echo "backup_step=blob-archive"
  set +e
  tar \
    --ignore-failed-read \
    --warning=no-file-changed \
    --exclude='*/.health-*' \
    --exclude='*.tmp-*' \
    -C "$(dirname "${blob_dir}")" \
    -czf "${work_dir}/blobs.tar.gz" \
    "$(basename "${blob_dir}")" \
    2>"${tar_log}"
  tar_status="$?"
  set -e
  if [ "${tar_status}" -ne 0 ]; then
    if [ "${tar_status}" -eq 1 ] && [ -s "${work_dir}/blobs.tar.gz" ]; then
      echo "Blob archive completed with recoverable live-file warnings:" >&2
      cat "${tar_log}" >&2
    else
      echo "Backup step failed (blob-archive) with exit status ${tar_status}." >&2
      cat "${tar_log}" >&2
      exit "${tar_status}"
    fi
  fi
else
  run_step blob-archive tar \
    --exclude='*/.health-*' \
    --exclude='*.tmp-*' \
    -C "$(dirname "${blob_dir}")" \
    -czf "${work_dir}/blobs.tar.gz" \
    "$(basename "${blob_dir}")"
fi

cat > "${work_dir}/manifest.txt" <<EOF
collab_backup_version=1
created_at=${timestamp}
postgres_database=${POSTGRES_DB}
postgres_user=${POSTGRES_USER}
postgres_host=${POSTGRES_HOST:-postgres}
blob_archive=blobs.tar.gz
postgres_archive=postgres.dump
EOF

{
  echo "backup_step=config-capture"
  echo "# Sanitized Collab server configuration captured with this backup."
  echo "# Secrets such as POSTGRES_PASSWORD, token signing keys, and session material are intentionally omitted."
  for name in \
    COLLAB_HTTP_BIND \
    COLLAB_HTTP_PORT \
    COLLAB_BROWSER_SECURE_COOKIES \
    COLLAB_NATIVE_ACCESS_TTL_MINUTES \
    COLLAB_NATIVE_REFRESH_TTL_DAYS \
    COLLAB_MAX_FILE_BYTES \
    COLLAB_MAX_IMPORT_BYTES \
    COLLAB_MAX_IMPORT_EXPANDED_BYTES \
    COLLAB_LOG_FORMAT \
    COLLAB_LOG \
    COLLAB_BACKUP_INTERVAL_SECONDS \
    COLLAB_BACKUP_RETENTION_DAYS
  do
    eval "value=\${${name}:-}"
    if [ -n "${value}" ]; then
      printf '%s=%s\n' "${name}" "${value}"
    fi
  done
} > "${work_dir}/config.env"

run_step checksums sh -c '
  cd "$1"
  sha256sum postgres.dump blobs.tar.gz manifest.txt config.env > checksums.sha256
' sh "${work_dir}"

run_step publish-backup mv "${work_dir}" "${backup_dir}"

if [ "${retention_days}" -gt 0 ] 2>/dev/null; then
  run_step prune-internal find "${backup_root}" -maxdepth 1 -type d -name 'collab-backup-*' -mtime "+${retention_days}" -exec rm -rf {} +
fi

if [ -n "${export_dir}" ]; then
  if [ ! -d "${export_dir}" ] || [ ! -w "${export_dir}" ]; then
    echo "External backup export target is not writable: ${export_dir}" >&2
    exit 67
  fi
  run_step export-backup cp -a "${backup_dir}" "${export_dir}/"
  if [ "${retention_days}" -gt 0 ] 2>/dev/null; then
    run_step prune-export find "${export_dir}" -maxdepth 1 -type d -name 'collab-backup-*' -mtime "+${retention_days}" -exec rm -rf {} +
  fi
  echo "Exported backup ${export_dir}/${backup_name}"
fi

echo "Created backup ${backup_dir}"
