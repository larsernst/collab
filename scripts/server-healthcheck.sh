#!/usr/bin/env bash
set -euo pipefail

host="${COLLAB_HEALTH_HOST:-127.0.0.1}"
port="${COLLAB_PORT:-8787}"
path="${COLLAB_HEALTH_PATH:-/health/ready}"

exec 3<>"/dev/tcp/${host}/${port}"
printf 'GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n' "${path}" "${host}" >&3

IFS= read -r status <&3
case "${status}" in
  HTTP/*" 200 "*)
    exit 0
    ;;
  *)
    echo "Healthcheck failed: ${status}" >&2
    exit 1
    ;;
esac
