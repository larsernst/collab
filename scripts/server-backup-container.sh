#!/bin/sh
set -eu

backup_root="${COLLAB_BACKUP_DIR:-/backups}"
blob_dir="${COLLAB_BLOB_DIR:-/data/blobs}"
export_dir="${COLLAB_BACKUP_EXPORT_DIR:-}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/collab-backup-${timestamp}"
retention_days="${COLLAB_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "${backup_dir}"

export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

pg_dump \
  --host="${POSTGRES_HOST:-postgres}" \
  --port="${POSTGRES_PORT:-5432}" \
  --username="${POSTGRES_USER:?POSTGRES_USER is required}" \
  --dbname="${POSTGRES_DB:?POSTGRES_DB is required}" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="${backup_dir}/postgres.dump"

tar -C "$(dirname "${blob_dir}")" -czf "${backup_dir}/blobs.tar.gz" "$(basename "${blob_dir}")"

cat > "${backup_dir}/manifest.txt" <<EOF
collab_backup_version=1
created_at=${timestamp}
postgres_database=${POSTGRES_DB}
postgres_user=${POSTGRES_USER}
postgres_host=${POSTGRES_HOST:-postgres}
blob_archive=blobs.tar.gz
postgres_archive=postgres.dump
EOF

{
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
} > "${backup_dir}/config.env"

(
  cd "${backup_dir}"
  sha256sum postgres.dump blobs.tar.gz manifest.txt config.env > checksums.sha256
)

if [ "${retention_days}" -gt 0 ] 2>/dev/null; then
  find "${backup_root}" -maxdepth 1 -type d -name 'collab-backup-*' -mtime "+${retention_days}" -exec rm -rf {} +
fi

if [ -n "${export_dir}" ]; then
  if [ ! -d "${export_dir}" ] || [ ! -w "${export_dir}" ]; then
    echo "External backup export target is not writable: ${export_dir}" >&2
    exit 67
  fi
  cp -a "${backup_dir}" "${export_dir}/"
  if [ "${retention_days}" -gt 0 ] 2>/dev/null; then
    find "${export_dir}" -maxdepth 1 -type d -name 'collab-backup-*' -mtime "+${retention_days}" -exec rm -rf {} +
  fi
  echo "Exported backup ${export_dir}/collab-backup-${timestamp}"
fi

echo "Created backup ${backup_dir}"
