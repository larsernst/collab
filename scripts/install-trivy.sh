#!/usr/bin/env bash
set -euo pipefail

version="${TRIVY_VERSION:-0.71.2}"
destination="${1:-${HOME}/.local/bin}"

case "$(uname -m)" in
  x86_64 | amd64)
    architecture="64bit"
    ;;
  aarch64 | arm64)
    architecture="ARM64"
    ;;
  *)
    echo "Unsupported Trivy installer architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

archive="trivy_${version}_Linux-${architecture}.tar.gz"
checksums="trivy_${version}_checksums.txt"
release_url="https://github.com/aquasecurity/trivy/releases/download/v${version}"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

curl --fail --silent --show-error --location \
  --output "${temporary_directory}/${archive}" \
  "${release_url}/${archive}"
curl --fail --silent --show-error --location \
  --output "${temporary_directory}/${checksums}" \
  "${release_url}/${checksums}"

(
  cd "${temporary_directory}"
  grep "  ${archive}$" "${checksums}" | sha256sum --check --strict -
  tar -xzf "${archive}" trivy
)

mkdir -p "${destination}"
install -m 0755 "${temporary_directory}/trivy" "${destination}/trivy"
"${destination}/trivy" --version
