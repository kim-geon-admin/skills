#!/bin/bash
# Runs inside debian:bookworm-slim (started by test-deploy.sh). Scenarios share NAS state, like
# consecutive real deploys. Env: PROJECT, IMAGE_PREFIX, SERVICES, BACKUP_FILE (may be empty).
set -u
read -r -a svcs <<< "$SERVICES"
first=${svcs[0]}
install -m 755 /t/mock-docker /usr/local/bin/docker
printf '#!/bin/sh\n[ "$1" = -n ] && shift\nexec "$@"\n' > /usr/bin/sudo
chmod 755 /usr/bin/sudo
export MOCK_PROJECT=$PROJECT MOCK_IMAGE_PREFIX=$IMAGE_PREFIX MOCK_SERVICES=$SERVICES MOCK_HEALTH_SERVICE=$first

D=/volume1/docker/$PROJECT
mkdir -p "$D/bin" /volume1/@docker
cp /t/deploy.sh /t/deploy-gate.sh "$D/bin/"
chmod 700 "$D/bin/deploy.sh"; chmod 755 "$D/bin/deploy-gate.sh"
echo "name: $PROJECT" > "$D/compose.yaml"
: > "$D/.env"; chmod 600 "$D/.env"
if [[ -n "$BACKUP_FILE" ]]; then mkdir -p "$(dirname "$BACKUP_FILE")"; echo db > "$BACKUP_FILE"; fi

A=$(printf 'a%.0s' {1..40}); B=$(printf 'b%.0s' {1..40}); C=$(printf 'c%.0s' {1..40})
E=$(printf 'e%.0s' {1..40}); F=$(printf 'f%.0s' {1..40})
pass=0; failn=0
deploy() { printf 'gh-user\nsecret-token\n' | SSH_ORIGINAL_COMMAND="$1" sh "$D/bin/deploy-gate.sh" > /tmp/out 2>&1; echo $?; }
check() {
  if eval "$2"; then echo "PASS $1"; pass=$((pass + 1))
  else echo "FAIL $1"; sed 's/^/    /' /tmp/out; failn=$((failn + 1)); fi
}
img() { cat "/mock/containers/$PROJECT-$first-1/image" 2>/dev/null; }
st() { cat "/mock/containers/$PROJECT-$first-1/status" 2>/dev/null; }

rc=$(deploy "whoami"); check "gate rejects shell command" '[[ $rc == 64 ]]'
rc=$(deploy "deploy $A; rm -rf /"); check "gate rejects injection" '[[ $rc == 64 ]]'
rc=$(printf '' | SSH_ORIGINAL_COMMAND="deploy $A" sh "$D/bin/deploy-gate.sh" > /tmp/out 2>&1; echo $?)
check "missing credentials rejected" '[[ $rc == 1 ]] && grep -q "credentials were not provided" /tmp/out'

rc=$(deploy "deploy $A"); check "1 first deploy (nothing on NAS)" '[[ $rc == 0 && $(img) == *:$A && $(st) == running && $(cat $D/state/current-tag) == $A ]]'
check "  token reached docker login via stdin only" '[[ $(cat /mock/login-stdin) == secret-token ]] && ! grep -q secret-token /mock/calls'

rc=$(deploy "deploy $B"); check "2 upgrade running A -> B" '[[ $rc == 0 && $(img) == *:$B && $(cat $D/state/previous-tag) == $A ]]'
if [[ -n "$BACKUP_FILE" ]]; then
  check "  backup taken" "ls $D/backups/*/$(basename "$BACKUP_FILE") >/dev/null 2>&1"
fi

rc=$(FAIL_TAG=$C deploy "deploy $C"); check "3 unhealthy C rolls back to B" '[[ $rc == 1 && $(img) == *:$B && $(st) == running && $(cat $D/state/current-tag) == $B ]] && grep -q "rollback to $B succeeded" /tmp/out'

for s in "${svcs[@]}"; do echo exited > "/mock/containers/$PROJECT-$s-1/status"; done
rc=$(FAIL_TAG=$C deploy "deploy $C"); check "4 stopped stack + failing C -> B restored and stopped again" '[[ $rc == 1 && $(img) == *:$B && $(st) == exited ]]'

rc=$(deploy "deploy $B"); check "5 same tag while stopped -> started" '[[ $rc == 0 && $(st) == running && $(cat $D/state/previous-tag) == $A ]]'
rc=$(deploy "deploy $B"); check "6 same tag while running -> reconcile only" '[[ $rc == 0 ]] && grep -q "reconciling without downtime" /tmp/out'

rc=$(PULL_FAIL=1 deploy "deploy $E"); check "7 pull failure leaves stack untouched" '[[ $rc == 1 && $(img) == *:$B && $(st) == running ]]'

rm -rf /mock/containers/*
rc=$(deploy "deploy $E"); check "8 containers deleted, images kept -> recreated" '[[ $rc == 0 && $(img) == *:$E && $(cat $D/state/previous-tag) == $B ]]'
check "  old images pruned, rollback image kept" '! grep -q ":$A" /mock/images && grep -q "$first:$B" /mock/images && grep -q "$first:$E" /mock/images'

echo manual > "/mock/containers/$PROJECT-$first-1/project"
rc=$(deploy "deploy $F"); check "9 foreign container with our name -> refuse" '[[ $rc == 1 ]] && grep -q "not managed by compose project" /tmp/out'
echo "$PROJECT" > "/mock/containers/$PROJECT-$first-1/project"

mkdir -p "$D/state/deploy.lock"; echo 999999 > "$D/state/deploy.lock/pid"
rc=$(deploy "deploy $F"); check "10 stale lock reclaimed" '[[ $rc == 0 ]] && grep -q "reclaiming stale lock" /tmp/out'

echo "passed=$pass failed=$failn"
[[ $failn == 0 ]]
