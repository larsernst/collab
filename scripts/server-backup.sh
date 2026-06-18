#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose)

"${compose[@]}" run --rm backup /usr/local/bin/collab-backup
