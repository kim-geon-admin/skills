#!/bin/bash
# Synology NAS deploy script (template: synology-github-actions-docker-deploy skill).
# Invoked as root by deploy-gate.sh through a single NOPASSWD sudo rule:
#   $1    40-char commit SHA whose images the GitHub Actions workflow pushed to GHCR
#   stdin registry user and token, one per line; used for this run only, never stored
#
# Order of operations keeps the running stack untouched until the new images are on disk:
#   preflight -> pull -> stop + backup -> up -> health check -> record or roll back
set -euo pipefail
shopt -s nullglob
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077

# --- Project settings (literal values; the test harness parses these lines) --------------------
readonly PROJECT=__PROJECT__
readonly IMAGE_PREFIX=ghcr.io/__GHCR_OWNER__/__PROJECT__
readonly SERVICES=(app)
# Host files copied while the stack is stopped, before every upgrade. SQLite -wal/-shm siblings
# are picked up automatically. Leave empty when the project has no local state worth keeping.
readonly BACKUP_FILES=()
readonly HEALTH_TIMEOUT_SECONDS=120
readonly STABLE_SECONDS=15
readonly MIN_FREE_MB=3072
readonly KEEP_BACKUPS=5
readonly KEEP_LOGS=20
# ------------------------------------------------------------------------------------------------

readonly DEPLOY_DIR=/volume1/docker/$PROJECT
readonly COMPOSE_FILE="$DEPLOY_DIR/compose.yaml"
readonly ENV_FILE="$DEPLOY_DIR/.env"
readonly STATE_DIR="$DEPLOY_DIR/state"
readonly LOG_DIR="$STATE_DIR/logs"
readonly LOCK_DIR="$STATE_DIR/deploy.lock"
readonly BACKUP_DIR="$DEPLOY_DIR/backups"
readonly REGISTRY=${IMAGE_PREFIX%%/*}

log() { printf '[deploy %s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*"; exit 1; }
is_tag() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

# --- Foreground (inside the SSH session) ------------------------------------------------------
# The real work runs detached and writes to a log file, so a dropped SSH connection or a
# cancelled workflow can never kill the script halfway through swapping containers.
if [[ "${1:-}" != --detached ]]; then
  new_tag="${1:-}"
  is_tag "$new_tag" || die "tag must be a 40-character commit SHA"
  registry_user='' registry_token=''
  IFS= read -r registry_user || true
  IFS= read -r registry_token || true
  [[ -n "$registry_user" && -n "$registry_token" ]] || die "registry credentials were not provided on stdin"

  mkdir -p "$LOG_DIR"
  log_file="$LOG_DIR/$(date '+%Y%m%d-%H%M%S')-${new_tag:0:12}.log"
  : > "$log_file"
  nohup "$0" --detached "$new_tag" > "$log_file" 2>&1 < <(printf '%s\n%s\n' "$registry_user" "$registry_token") &
  deploy_pid=$!
  unset registry_token

  tail -n +1 -f "$log_file" &
  tail_pid=$!
  status=0
  wait "$deploy_pid" || status=$?
  sleep 1
  kill "$tail_pid" 2>/dev/null || true
  exit "$status"
fi

# --- Detached worker ---------------------------------------------------------------------------
new_tag="${2:-}"
is_tag "$new_tag" || die "tag must be a 40-character commit SHA"
registry_user='' registry_token=''
IFS= read -r registry_user || true
IFS= read -r registry_token || true

DOCKER=$(command -v docker || true)
[[ -n "$DOCKER" ]] || die "docker not found (is Container Manager installed and running?)"
"$DOCKER" info >/dev/null 2>&1 || die "docker daemon is not reachable"
if "$DOCKER" compose version >/dev/null 2>&1; then
  COMPOSE=("$DOCKER" compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "neither 'docker compose' nor 'docker-compose' is available"
fi

# compose <image tag> <compose args...>
compose() {
  local tag="$1"
  shift
  IMAGE_TAG="$tag" "${COMPOSE[@]}" --project-directory "$DEPLOY_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}
container_id() { compose "$1" ps -a -q "$2" 2>/dev/null | head -n 1 || true; }
container_field() { "$DOCKER" inspect -f "$2" "$1" 2>/dev/null || true; }

# Only one deploy at a time; a lock left behind by a dead process is reclaimed.
mkdir -p "$STATE_DIR" "$BACKUP_DIR"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  holder=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [[ -n "$holder" ]] && kill -0 "$holder" 2>/dev/null; then
    die "another deploy (pid $holder) is still running"
  fi
  log "reclaiming stale lock from pid ${holder:-unknown}"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo $$ > "$LOCK_DIR/pid"
REGISTRY_CONFIG=$(mktemp -d)
cleanup() { rm -rf "$REGISTRY_CONFIG" "$LOCK_DIR"; }
trap cleanup EXIT

log "deploying $new_tag"

# --- Preflight: nothing below changes the running stack ----------------------------------------
[[ -f "$COMPOSE_FILE" ]] || die "missing $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE (create it, even empty, with mode 600)"
env_mode=$(stat -c '%a' "$ENV_FILE")
[[ "$env_mode" == 600 || "$env_mode" == 400 ]] || log "WARNING: $ENV_FILE has mode $env_mode; run: chmod 600 $ENV_FILE"
compose "$new_tag" config -q || die "compose configuration is invalid"

docker_root=$("$DOCKER" info --format '{{.DockerRootDir}}' 2>/dev/null || echo /volume1)
free_mb=$(df -Pm "$docker_root" | awk 'NR == 2 { print $4 }') || die "cannot read free space of $docker_root"
(( free_mb >= MIN_FREE_MB )) || die "only ${free_mb}MB free under $docker_root (need ${MIN_FREE_MB}MB)"

# A container that already uses one of our names but belongs to no compose project (for example
# one created by hand in Container Manager) is never removed automatically.
for service in "${SERVICES[@]}"; do
  name="$PROJECT-$service-1"
  if "$DOCKER" inspect "$name" >/dev/null 2>&1; then
    owner=$(container_field "$name" '{{index .Config.Labels "com.docker.compose.project"}}')
    [[ "$owner" == "$PROJECT" ]] || die "container $name exists but is not managed by compose project $PROJECT; remove it manually"
  fi
done

# --- Current state -----------------------------------------------------------------------------
current_tag=$(cat "$STATE_DIR/current-tag" 2>/dev/null || true)
was_running=false
for service in "${SERVICES[@]}"; do
  id=$(container_id "$new_tag" "$service")
  if [[ -z "$id" ]]; then
    log "before: $service has no container"
    continue
  fi
  status=$(container_field "$id" '{{.State.Status}}')
  image=$(container_field "$id" '{{.Config.Image}}')
  log "before: $service is $status ($image)"
  if [[ "$status" == running || "$status" == restarting ]]; then
    was_running=true
  fi
  # Stacks deployed before this script existed have no state file; trust the container's tag.
  if [[ -z "$current_tag" && "$image" == "$IMAGE_PREFIX-$service:"* ]]; then
    current_tag=${image##*:}
  fi
done
is_tag "$current_tag" || current_tag=''
if [[ -n "$current_tag" && "$current_tag" != "$new_tag" ]]; then
  rollback_tag=$current_tag
else
  rollback_tag=$(cat "$STATE_DIR/previous-tag" 2>/dev/null || true)
fi
is_tag "$rollback_tag" && [[ "$rollback_tag" != "$new_tag" ]] || rollback_tag=''
log "current: ${current_tag:-none}, rollback target: ${rollback_tag:-none}"

# --- Pull (the running stack keeps serving while this happens) ---------------------------------
registry() { DOCKER_CONFIG="$REGISTRY_CONFIG" "$DOCKER" "$@"; }
printf '%s' "$registry_token" | registry login "$REGISTRY" -u "$registry_user" --password-stdin >/dev/null \
  || die "registry login failed"
unset registry_token
for service in "${SERVICES[@]}"; do
  log "pulling $IMAGE_PREFIX-$service:$new_tag"
  registry pull --quiet "$IMAGE_PREFIX-$service:$new_tag" >/dev/null || die "pull failed for $service; stack left untouched"
done
# Make sure a rollback never depends on the registry being reachable later.
if [[ -n "$rollback_tag" ]]; then
  for service in "${SERVICES[@]}"; do
    ref="$IMAGE_PREFIX-$service:$rollback_tag"
    if ! "$DOCKER" image inspect "$ref" >/dev/null 2>&1 && ! registry pull --quiet "$ref" >/dev/null 2>&1; then
      log "WARNING: rollback image $ref is unavailable; automatic rollback disabled"
      rollback_tag=''
      break
    fi
  done
fi
registry logout "$REGISTRY" >/dev/null 2>&1 || true

# --- Health verification -----------------------------------------------------------------------
# A service with a compose healthcheck must reach "healthy"; one without must be "running".
verify_stack() {
  local tag="$1" deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local service id health status pending
  declare -A ids=() restarts=()
  for service in "${SERVICES[@]}"; do
    id=$(container_id "$tag" "$service")
    if [[ -z "$id" ]]; then
      log "$service container was not created"
      return 1
    fi
    if [[ "$(container_field "$id" '{{.Config.Image}}')" != "$IMAGE_PREFIX-$service:$tag" ]]; then
      log "$service is not running image $tag"
      return 1
    fi
    ids[$service]=$id
  done
  while :; do
    pending=''
    for service in "${SERVICES[@]}"; do
      health=$(container_field "${ids[$service]}" '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
      status=$(container_field "${ids[$service]}" '{{.State.Status}}')
      if [[ "$health" == unhealthy ]]; then
        log "$service reported unhealthy"
        return 1
      fi
      if [[ "$status" != running || ( "$health" != healthy && "$health" != none ) ]]; then
        pending+=" $service($status/$health)"
      fi
    done
    [[ -z "$pending" ]] && break
    if (( SECONDS >= deadline )); then
      log "timed out waiting for:$pending"
      return 1
    fi
    sleep 3
  done
  # Crash loops can look healthy for a moment; require no restarts over a short window.
  for service in "${SERVICES[@]}"; do
    restarts[$service]=$(container_field "${ids[$service]}" '{{.RestartCount}}')
  done
  sleep "$STABLE_SECONDS"
  for service in "${SERVICES[@]}"; do
    if [[ "$(container_field "${ids[$service]}" '{{.State.Status}}')" != running \
      || "$(container_field "${ids[$service]}" '{{.RestartCount}}')" != "${restarts[$service]}" ]]; then
      log "$service restarted during the stability window"
      return 1
    fi
  done
  log "health check passed for $tag"
}

show_logs() { compose "$1" logs --no-color --tail 40 || true; }

backup_path=''
roll_back() {
  log "deploy of $new_tag failed"
  show_logs "$new_tag"
  if [[ -z "$rollback_tag" ]]; then
    log "no previous version to roll back to; stopping the failed stack"
    compose "$new_tag" stop || true
    exit 1
  fi
  log "rolling back to $rollback_tag"
  if compose "$rollback_tag" up -d --remove-orphans && verify_stack "$rollback_tag"; then
    if ! $was_running; then
      log "stack was stopped before the deploy; stopping it again"
      compose "$rollback_tag" stop || true
    fi
    log "rollback to $rollback_tag succeeded (backup: ${backup_path:-none})"
  else
    log "ROLLBACK FAILED - manual intervention required (backup: ${backup_path:-none})"
    show_logs "$rollback_tag"
  fi
  exit 1
}

# --- Same tag already deployed: reconcile only (re-run, or .env/compose.yaml changed on the NAS) --
if [[ "$current_tag" == "$new_tag" ]] && $was_running; then
  log "$new_tag is already deployed; reconciling without downtime"
  if compose "$new_tag" up -d --remove-orphans && verify_stack "$new_tag"; then
    log "done: $new_tag is running"
    exit 0
  fi
  roll_back
fi

# --- Swap ----------------------------------------------------------------------------------------
# Stop first so state files (SQLite and friends) are consistent on disk while they are copied.
compose "$new_tag" stop -t 30 || roll_back
if (( ${#BACKUP_FILES[@]} > 0 )); then
  backup_path="$BACKUP_DIR/$(date '+%Y%m%d-%H%M%S')-${current_tag:0:12}"
  mkdir -p "$backup_path"
  for file in "${BACKUP_FILES[@]}"; do
    for candidate in "$file" "$file-wal" "$file-shm"; do
      if [[ -f "$candidate" ]]; then
        cp -p "$candidate" "$backup_path/" || roll_back
      fi
    done
  done
  if rmdir "$backup_path" 2>/dev/null; then
    backup_path=''
    log "nothing to back up yet"
  else
    log "backed up to $backup_path"
  fi
fi

compose "$new_tag" up -d --remove-orphans || roll_back
verify_stack "$new_tag" || roll_back

# --- Record and clean up -------------------------------------------------------------------------
if [[ -n "$current_tag" && "$current_tag" != "$new_tag" ]]; then
  echo "$current_tag" > "$STATE_DIR/previous-tag"
fi
echo "$new_tag" > "$STATE_DIR/current-tag"
keep_tag=$rollback_tag

# Keep only the deployed images and the rollback target of this project.
service_pattern=$(IFS='|'; echo "${SERVICES[*]}")
image_pattern="^${IMAGE_PREFIX//./\\.}-($service_pattern):[0-9a-f]{40}$"
while IFS= read -r ref; do
  tag=${ref##*:}
  [[ "$tag" == "$new_tag" || "$tag" == "$keep_tag" ]] && continue
  "$DOCKER" image rm "$ref" >/dev/null 2>&1 && log "removed old image $ref" || true
done < <("$DOCKER" image ls --format '{{.Repository}}:{{.Tag}}' | grep -E "$image_pattern" || true)

backups=("$BACKUP_DIR"/*/)
if (( ${#backups[@]} > KEEP_BACKUPS )); then
  for old in "${backups[@]:0:${#backups[@]}-KEEP_BACKUPS}"; do
    rm -rf -- "$old"
  done
fi
logs=("$LOG_DIR"/*.log)
if (( ${#logs[@]} > KEEP_LOGS )); then
  for old in "${logs[@]:0:${#logs[@]}-KEEP_LOGS}"; do
    rm -f -- "$old"
  done
fi

log "done: $new_tag is running (rollback target: ${keep_tag:-none})"
