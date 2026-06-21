#!/usr/bin/env bash
set -euo pipefail

image="${COLLAB_IMAGE_NAME:-collab-server:local}"
platforms="${COLLAB_IMAGE_PLATFORMS:-linux/amd64,linux/arm64}"
output="${COLLAB_IMAGE_OUTPUT:-dist-builds/collab-server-multiarch.tar}"
build_network="${COLLAB_IMAGE_BUILD_NETWORK:-default}"

usage() {
  cat <<EOF
Usage: ./scripts/server-container-build.sh [--push]

Builds the collaboration server for multiple architectures with Docker Buildx.
By default it writes a multi-platform OCI archive without publishing it.

Environment:
  COLLAB_IMAGE_NAME=${image}
  COLLAB_IMAGE_PLATFORMS=${platforms}
  COLLAB_IMAGE_OUTPUT=${output}
  COLLAB_IMAGE_BUILD_NETWORK=${build_network}

Modes:
  (default)  Write an OCI archive to COLLAB_IMAGE_OUTPUT.
  --push     Push a multi-platform manifest to COLLAB_IMAGE_NAME.
EOF
}

case "${1:-}" in
  "")
    mode="archive"
    ;;
  --push)
    mode="push"
    ;;
  help | --help | -h)
    usage
    exit 0
    ;;
  *)
    echo "Unknown option: $1" >&2
    usage >&2
    exit 64
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build the server image." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker Buildx is required. Install or enable the Buildx plugin." >&2
  exit 1
fi

if [[ "${mode}" == "push" ]]; then
  echo "==> Building and pushing ${image} for ${platforms}"
  docker buildx build \
    --platform "${platforms}" \
    --network "${build_network}" \
    --file Dockerfile.server \
    --tag "${image}" \
    --push \
    .
  exit 0
fi

mkdir -p "$(dirname "${output}")"
echo "==> Building ${image} for ${platforms}"
echo "==> Writing multi-platform OCI archive to ${output}"
docker buildx build \
  --platform "${platforms}" \
  --network "${build_network}" \
  --file Dockerfile.server \
  --tag "${image}" \
  --output "type=oci,dest=${output}" \
  .
