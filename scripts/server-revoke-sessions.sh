#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/server-revoke-sessions.sh

Revokes every active browser and native session in the Compose PostgreSQL
database. Use this after suspected token theft, administrator password changes,
or a credential rotation where all clients should sign in again.

Set COLLAB_REVOKE_SESSIONS_CONFIRM=revoke to skip the interactive prompt.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 0 ]]; then
  usage >&2
  exit 64
fi

if [[ "${COLLAB_REVOKE_SESSIONS_CONFIRM:-}" != "revoke" ]]; then
  echo "This will sign out every browser and native Collab server session."
  read -r -p "Type revoke to continue: " answer
  if [[ "${answer}" != "revoke" ]]; then
    echo "Session revocation cancelled." >&2
    exit 65
  fi
fi

postgres_user="${POSTGRES_USER:-collab}"
postgres_db="${POSTGRES_DB:-collab}"

docker compose exec -T postgres \
  psql -U "${postgres_user}" -d "${postgres_db}" -v ON_ERROR_STOP=1 <<'SQL'
WITH browser AS (
  UPDATE sessions
     SET revoked_at = NOW()
   WHERE revoked_at IS NULL
     AND expires_at > NOW()
  RETURNING 1
),
native AS (
  UPDATE native_sessions
     SET revoked_at = NOW()
   WHERE revoked_at IS NULL
     AND refresh_expires_at > NOW()
  RETURNING 1
)
SELECT
  (SELECT COUNT(*) FROM browser) AS browser_sessions_revoked,
  (SELECT COUNT(*) FROM native) AS native_sessions_revoked;
SQL
