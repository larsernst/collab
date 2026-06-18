#!/bin/sh
set -eu

usage() {
  echo "Usage: collab-restore /backups/collab-backup-YYYYMMDDTHHMMSSZ" >&2
  echo "Set COLLAB_RESTORE_CONFIRM=restore to allow destructive restore." >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 64
fi

if [ "${COLLAB_RESTORE_CONFIRM:-}" != "restore" ]; then
  usage
  exit 65
fi

backup_dir="$1"
case "${backup_dir}" in
  /*) ;;
  *) backup_dir="/backups/${backup_dir}" ;;
esac

if [ ! -d "${backup_dir}" ]; then
  echo "Backup directory not found: ${backup_dir}" >&2
  exit 66
fi

for artifact in postgres.dump blobs.tar.gz manifest.txt checksums.sha256; do
  if [ ! -f "${backup_dir}/${artifact}" ]; then
    echo "Backup artifact missing: ${backup_dir}/${artifact}" >&2
    exit 66
  fi
done

(
  cd "${backup_dir}"
  sha256sum -c checksums.sha256
)

blob_dir="${COLLAB_BLOB_DIR:-/data/blobs}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
safety_dir="/backups/restore-safety"
mkdir -p "${safety_dir}" "${blob_dir}"

export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

echo "Replacing PostgreSQL schema in database ${POSTGRES_DB}"
psql \
  --host="${POSTGRES_HOST:-postgres}" \
  --port="${POSTGRES_PORT:-5432}" \
  --username="${POSTGRES_USER:?POSTGRES_USER is required}" \
  --dbname="${POSTGRES_DB:?POSTGRES_DB is required}" \
  --set=ON_ERROR_STOP=1 \
  --command="DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

pg_restore \
  --host="${POSTGRES_HOST:-postgres}" \
  --port="${POSTGRES_PORT:-5432}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-acl \
  "${backup_dir}/postgres.dump"

if find "${blob_dir}" -mindepth 1 -print -quit | grep -q .; then
  tar -C "$(dirname "${blob_dir}")" -czf "${safety_dir}/blobs-before-restore-${timestamp}.tar.gz" "$(basename "${blob_dir}")"
fi

find "${blob_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -C "$(dirname "${blob_dir}")" -xzf "${backup_dir}/blobs.tar.gz"

echo "Restored backup ${backup_dir}"
