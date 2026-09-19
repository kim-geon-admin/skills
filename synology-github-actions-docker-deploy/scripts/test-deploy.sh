#!/bin/bash
# Exercises deploy.sh / deploy-gate.sh state handling inside debian:bookworm-slim against a mocked
# docker CLI (no real containers, no registry). Needs Docker on the machine running it.
#   scripts/test-deploy.sh                                # render and test the skill templates
#   scripts/test-deploy.sh <deploy.sh> <deploy-gate.sh>   # test a project's customized copies
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [[ $# -eq 0 ]]; then
  sed -e 's/__PROJECT__/demo/g' -e 's/__GHCR_OWNER__/example/g' \
      -e 's/^readonly SERVICES=(app)$/readonly SERVICES=(app worker)/' \
      -e 's|^readonly BACKUP_FILES=()$|readonly BACKUP_FILES=(/volume1/docker/demo/data/app.sqlite)|' \
      "$here/../templates/deploy.sh" > "$work/deploy.sh"
  sed 's/__PROJECT__/demo/g' "$here/../templates/deploy-gate.sh" > "$work/deploy-gate.sh"
elif [[ $# -eq 2 ]]; then
  cp "$1" "$work/deploy.sh"
  cp "$2" "$work/deploy-gate.sh"
else
  echo "usage: $0 [deploy.sh deploy-gate.sh]" >&2
  exit 2
fi
# The stability window only slows the scenarios down; its logic is still exercised.
sed -i -e 's/^readonly STABLE_SECONDS=.*/readonly STABLE_SECONDS=2/' -e 's/\r$//' "$work/deploy.sh"
sed -i 's/\r$//' "$work/deploy-gate.sh"
cp "$here/mock-docker" "$here/run-scenarios.sh" "$work/"
sed -i 's/\r$//' "$work/mock-docker" "$work/run-scenarios.sh"

field() { sed -n "s/^readonly $1=//p" "$work/deploy.sh" | head -n 1; }
project=$(field PROJECT)
image_prefix=$(field IMAGE_PREFIX)
services=$(field SERVICES | tr -d '()')
backup_file=$(field BACKUP_FILES | tr -d '()' | awk '{ print $1 }')
[[ -n "$project" && -n "$image_prefix" && -n "$services" ]] || { echo "could not read settings from deploy.sh" >&2; exit 2; }

# Docker Desktop on Windows needs a Windows path for the bind mount.
mount_src=$work
command -v cygpath >/dev/null 2>&1 && mount_src=$(cygpath -m "$work")

MSYS_NO_PATHCONV=1 docker run --rm -v "$mount_src:/t:ro" \
  -e PROJECT="$project" -e IMAGE_PREFIX="$image_prefix" -e SERVICES="$services" -e BACKUP_FILE="$backup_file" \
  debian:bookworm-slim bash /t/run-scenarios.sh
