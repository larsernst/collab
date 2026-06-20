#!/usr/bin/env bash
set -euo pipefail

# Coarse load test for a running collaboration server. It drives read-heavy
# traffic against the gateway and (optionally) authenticated hosted-vault reads,
# so an operator can size a deployment and confirm rate limits, health, and the
# reverse proxy behave under concurrency. It targets an already-running server;
# start the stack first (e.g. `docker compose up --wait`).

url="${COLLAB_LOAD_URL:-http://127.0.0.1:${COLLAB_HTTP_PORT:-8788}}"
duration="${COLLAB_LOAD_DURATION:-30s}"
concurrency="${COLLAB_LOAD_CONCURRENCY:-50}"
username="${COLLAB_LOAD_USERNAME:-}"
password="${COLLAB_LOAD_PASSWORD:-}"

usage() {
  cat <<EOF
Usage: ./scripts/server-load-test.sh [help]

Drives concurrent read traffic against a running collaboration server and
prints a throughput/latency summary. Authenticated hosted-vault reads are
included when credentials are provided.

Environment:
  COLLAB_LOAD_URL=${url}
  COLLAB_LOAD_DURATION=${duration}
  COLLAB_LOAD_CONCURRENCY=${concurrency}
  COLLAB_LOAD_USERNAME=${username:-<unset; skips authenticated phase>}
  COLLAB_LOAD_PASSWORD=${password:+<set>}${password:-<unset>}

Load generators, first available wins:
  oha
  hey
  wrk            (requires a temporary Lua script for headers)
  curl           (portable fallback: fixed request count, coarse timing)

Notes:
  - Health checks, the admin SPA, and the root redirect are never rate limited.
  - Authenticated traffic is subject to COLLAB_REST_RATE_LIMIT_PER_MINUTE.
    Lower the concurrency/duration or raise the limit if you only want a
    capacity test rather than a rate-limit test.
EOF
}

if [[ "${1:-}" =~ ^(help|--help|-h)$ ]]; then
  usage
  exit 0
fi

preflight() {
  echo "==> Preflight: ${url}/health/ready"
  if ! curl --fail --silent --show-error --max-time 10 "${url}/health/ready" >/dev/null; then
    echo "Server is not ready at ${url}. Start it first (docker compose up --wait)." >&2
    exit 1
  fi
}

# $1 = label, $2 = full URL, remaining args = extra curl/tool headers (as "-H" "Header: v")
run_load() {
  local label="$1"
  local target="$2"
  shift 2
  local -a headers=("$@")

  echo
  echo "==> Load: ${label}"
  echo "    target=${target} concurrency=${concurrency} duration=${duration}"

  if command -v oha >/dev/null 2>&1; then
    oha --no-tui -z "${duration}" -c "${concurrency}" "${headers[@]}" "${target}"
    return
  fi

  if command -v hey >/dev/null 2>&1; then
    # hey takes seconds for -z, strip a trailing "s" if present.
    hey -z "${duration%s}s" -c "${concurrency}" "${headers[@]}" "${target}"
    return
  fi

  if command -v wrk >/dev/null 2>&1; then
    local script=""
    if [[ ${#headers[@]} -gt 0 ]]; then
      script="$(mktemp)"
      {
        echo "wrk.method = \"GET\""
        local i=0
        while [[ $i -lt ${#headers[@]} ]]; do
          # headers come as: -H "Name: value"
          local hv="${headers[$((i + 1))]}"
          printf 'wrk.headers["%s"] = "%s"\n' "${hv%%:*}" "${hv#*: }"
          i=$((i + 2))
        done
      } >"${script}"
      wrk -t"$(nproc 2>/dev/null || echo 4)" -c"${concurrency}" -d"${duration}" -s "${script}" "${target}"
      rm -f "${script}"
    else
      wrk -t"$(nproc 2>/dev/null || echo 4)" -c"${concurrency}" -d"${duration}" "${target}"
    fi
    return
  fi

  echo "    No load generator (oha/hey/wrk) found; using portable curl fallback." >&2
  curl_fallback "${target}" "${headers[@]}"
}

# Portable, coarse fallback: fixed number of requests across background workers.
curl_fallback() {
  local target="$1"
  shift
  local -a headers=("$@")
  local total="${COLLAB_LOAD_REQUESTS:-1000}"
  local per_worker=$(((total + concurrency - 1) / concurrency))
  local start end
  start="$(date +%s.%N)"

  for _ in $(seq 1 "${concurrency}"); do
    (
      for _ in $(seq 1 "${per_worker}"); do
        curl --silent --output /dev/null --max-time 15 "${headers[@]}" "${target}" || true
      done
    ) &
  done
  wait

  end="$(date +%s.%N)"
  local elapsed
  elapsed="$(awk -v s="${start}" -v e="${end}" 'BEGIN { printf "%.2f", e - s }')"
  local sent=$((per_worker * concurrency))
  awk -v n="${sent}" -v t="${elapsed}" \
    'BEGIN { printf "    sent=%d elapsed=%ss throughput=%.1f req/s\n", n, t, (t > 0 ? n / t : 0) }'
}

authenticate() {
  echo "==> Authenticating ${username} for hosted-vault reads"
  local body
  body="$(curl --fail --silent --show-error \
    --max-time 15 \
    -H 'Content-Type: application/json' \
    -X POST "${url}/api/v1/auth/native/login" \
    -d "{\"username\":\"${username}\",\"password\":\"${password}\",\"clientName\":\"load-test\"}")" || {
    echo "Authentication failed; skipping authenticated phase." >&2
    return 1
  }

  # Extract accessToken without requiring jq.
  local token
  if command -v jq >/dev/null 2>&1; then
    token="$(printf '%s' "${body}" | jq -r '.accessToken')"
  else
    token="$(printf '%s' "${body}" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
  fi

  if [[ -z "${token}" || "${token}" == "null" ]]; then
    echo "Could not read accessToken from login response; skipping authenticated phase." >&2
    return 1
  fi
  printf '%s' "${token}"
}

main() {
  preflight

  run_load "liveness" "${url}/health/live"
  run_load "readiness" "${url}/health/ready"
  run_load "bootstrap status" "${url}/api/v1/auth/bootstrap-status"
  run_load "admin SPA" "${url}/admin/"

  if [[ -n "${username}" && -n "${password}" ]]; then
    local token
    if token="$(authenticate)"; then
      run_load "hosted vault list (authenticated)" \
        "${url}/api/v1/vaults" \
        -H "Authorization: Bearer ${token}"
    fi
  else
    echo
    echo "==> Skipping authenticated phase (set COLLAB_LOAD_USERNAME and COLLAB_LOAD_PASSWORD to include it)."
  fi

  echo
  echo "==> Load test complete. Record results in docs/server/load-testing.md."
}

main "$@"
