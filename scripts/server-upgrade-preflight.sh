#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose)
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_dir="${COLLAB_UPGRADE_REPORT_DIR:-server-data/upgrade-preflight}"
report_path="${report_dir}/upgrade-preflight-${timestamp}.txt"

mkdir -p "${report_dir}"

echo "Running Collab server upgrade preflight..."
echo "Report: ${report_path}"
{
  echo "collab_upgrade_preflight_version=1"
  echo "created_at=${timestamp}"
  echo
  echo "[compose_services]"
  "${compose[@]}" ps || true
  echo
  echo "[migrations_before_upgrade]"
  "${compose[@]}" exec -T postgres psql \
    -U "${POSTGRES_USER:-collab}" \
    -d "${POSTGRES_DB:-collab}" \
    -c "SELECT version, description, installed_on, success FROM _sqlx_migrations ORDER BY version;" \
    || echo "Migration table was not readable."
  echo
} >"${report_path}"

backup_output="$(./scripts/server-backup.sh)"
printf '%s\n' "${backup_output}"
backup_path="$(printf '%s\n' "${backup_output}" | sed -n 's/^Created backup //p' | tail -n 1)"
backup_name="$(basename "${backup_path}")"

if [[ -z "${backup_name}" || "${backup_name}" == "." ]]; then
  echo "Could not determine the created backup name." >&2
  exit 1
fi

./scripts/server-backups.sh verify "${backup_name}"

{
  echo "[verified_backup]"
  echo "backup_name=${backup_name}"
  echo "backup_path=${backup_path}"
  echo
  echo "[rollback]"
  echo "COLLAB_RESTORE_CONFIRM=restore pnpm server:restore ${backup_name}"
  echo
} >>"${report_path}"

echo
echo "Upgrade preflight complete."
echo "Verified backup: ${backup_name}"
echo "Report: ${report_path}"
echo
echo "If the upgrade fails before the server becomes healthy, roll back with:"
echo "  COLLAB_RESTORE_CONFIRM=restore pnpm server:restore ${backup_name}"
