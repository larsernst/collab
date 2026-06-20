#!/usr/bin/env bash
set -euo pipefail

image="${COLLAB_SCAN_IMAGE:-collab-server:security-scan}"
severity="${COLLAB_SCAN_SEVERITY:-HIGH,CRITICAL}"
audit_level="${COLLAB_PNPM_AUDIT_LEVEL:-high}"
build_image="${COLLAB_SCAN_BUILD_IMAGE:-1}"

usage() {
  cat <<EOF
Usage: ./scripts/server-security-scan.sh [dependency|container|all]

Runs the local production-hardening vulnerability checks.

Environment:
  COLLAB_SCAN_IMAGE=${image}
  COLLAB_SCAN_SEVERITY=${severity}
  COLLAB_SCAN_BUILD_IMAGE=${build_image}
  COLLAB_PNPM_AUDIT_LEVEL=${audit_level}

Dependency scanners:
  pnpm audit
  cargo audit        (optional locally; required in CI)

Container scanners, first available wins:
  trivy image
  grype
  docker scout cves
EOF
}

require_command() {
  local command="$1"
  local install_hint="$2"
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Missing ${command}. ${install_hint}" >&2
    return 1
  fi
}

scan_dependencies() {
  echo "==> Scanning JavaScript dependencies with pnpm audit (${audit_level})"
  require_command pnpm "Install pnpm or enable Corepack." || return 1
  pnpm audit --audit-level "${audit_level}"

  echo "==> Scanning Rust dependencies with cargo audit"
  if command -v cargo-audit >/dev/null 2>&1; then
    cargo audit
  elif cargo audit --version >/dev/null 2>&1; then
    cargo audit
  else
    echo "cargo-audit is not installed. Install with: cargo install cargo-audit --locked" >&2
    return 1
  fi
}

build_container_image() {
  if [[ "${build_image}" == "0" ]]; then
    echo "==> Skipping Docker image build; scanning existing image ${image}"
    return
  fi
  echo "==> Building ${image} from Dockerfile.server"
  docker build -f Dockerfile.server -t "${image}" .
}

scan_container() {
  require_command docker "Install Docker to build or scan the server image." || return 1
  build_container_image

  if command -v trivy >/dev/null 2>&1; then
    echo "==> Scanning ${image} with Trivy (${severity})"
    trivy image --exit-code 1 --severity "${severity}" --ignore-unfixed "${image}"
    return
  fi

  if command -v grype >/dev/null 2>&1; then
    echo "==> Scanning ${image} with Grype (${severity})"
    grype "${image}" --fail-on high
    return
  fi

  if docker scout version >/dev/null 2>&1; then
    echo "==> Scanning ${image} with Docker Scout (${severity})"
    docker scout cves --exit-code --only-severity "${severity}" "${image}"
    return
  fi

  echo "No container scanner found. Install Trivy, Grype, or Docker Scout." >&2
  return 1
}

command="${1:-all}"
case "${command}" in
  dependency | dependencies | deps)
    scan_dependencies
    ;;
  container | image)
    scan_container
    ;;
  all)
    scan_dependencies
    scan_container
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    echo "Unknown scan command: ${command}" >&2
    usage >&2
    exit 64
    ;;
esac
