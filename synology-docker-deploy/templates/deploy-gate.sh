#!/bin/sh
# SSH forced command for the GitHub Actions deploy key (template: synology-docker-deploy skill).
# Runs as the deploy user. The only accepted request is "deploy <40-char commit SHA>";
# anything else (shell, scp, sftp, port forwarding requests) is rejected.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin

request="${SSH_ORIGINAL_COMMAND:-}"
case "$request" in
  "deploy "*) tag="${request#deploy }" ;;
  *) echo "deploy-gate: rejected request" >&2; exit 64 ;;
esac

case "$tag" in
  *[!0-9a-f]*) echo "deploy-gate: rejected tag" >&2; exit 64 ;;
esac
if [ "${#tag}" -ne 40 ]; then
  echo "deploy-gate: rejected tag" >&2
  exit 64
fi

exec sudo -n /volume1/docker/__PROJECT__/bin/deploy.sh "$tag"
