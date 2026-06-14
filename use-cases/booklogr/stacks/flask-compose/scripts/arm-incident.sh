#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # = $SCRIPTS
STACK="$(dirname "$HERE")"                              # = stacks/flask-compose
SCRIPTS="$HERE"

# 1. Guard: substrate must be imported
echo "==> Checking substrate workspace..."
if [ ! -d "$STACK/substrate/booklogr/.git" ]; then
  echo "ERROR: substrate not found at $STACK/substrate/booklogr — run import-substrate.sh first" >&2
  exit 1
fi

# 1b. Prune leftover per-run fix branches (local + forge) so the history an
# agent clones — and the contamination-guard's `git log --all` — stays clean.
echo "==> Pruning leftover fix/* branches..."
WORK="$STACK/substrate/booklogr"
for ref in $(git -C "$WORK" ls-remote --heads origin 'fix/*' 2>/dev/null | awk '{print $2}'); do
  git -C "$WORK" push origin --delete "${ref#refs/heads/}" >/dev/null 2>&1 || true
done
for lb in $(git -C "$WORK" for-each-ref --format='%(refname:short)' 'refs/heads/fix/*' 2>/dev/null); do
  git -C "$WORK" branch -D "$lb" >/dev/null 2>&1 || true
done

# 2. Re-regress the forge default branch (reset main to immutable regressed baseline)
echo "==> Re-regressing forge: resetting origin/main to origin/baseline..."
git -C "$STACK/substrate/booklogr" fetch origin --prune --quiet
git -C "$STACK/substrate/booklogr" push -f origin origin/baseline:main

# 3. Reset the local workspace onto the regressed baseline on a clean main
echo "==> Resetting local workspace to origin/baseline..."
git -C "$STACK/substrate/booklogr" checkout -B main origin/baseline
git -C "$STACK/substrate/booklogr" reset --hard origin/baseline
git -C "$STACK/substrate/booklogr" clean -fd

# 3b. Quiesce any in-flight load BEFORE bringing up the regressed baseline.
# Deploying a NullCache build straight into an active storm saturates all four
# gunicorn workers on the slow upstream, so even the GET / healthcheck (3s
# timeout) can never get a free worker and the container never reports healthy.
# The incident is established by APPLYING load to a healthy baseline, not by
# booting the baseline under load — so stop the storm, settle, then re-apply it.
echo "==> Quiescing load (stop k6) before regressed redeploy..."
docker stop booklogr-k6 >/dev/null 2>&1 || true

# 4. Redeploy the regressed api and wait healthy (max ~90s)
echo "==> Deploying regressed booklogr-api..."
docker compose -p booklogr -f "$STACK/compose/docker-compose.yml" up -d --build booklogr-api

echo "==> Waiting for booklogr-api to become healthy (max 90s)..."
healthy=0
for i in $(seq 1 30); do
  s=$(docker inspect -f '{{.State.Health.Status}}' booklogr-api 2>/dev/null || true)
  if [ "$s" = "healthy" ]; then
    healthy=1
    break
  fi
  sleep 3
done

if [ "$healthy" -ne 1 ]; then
  echo "ERROR: booklogr-api did not become healthy within 90s" >&2
  exit 1
fi
echo "==> booklogr-api is healthy"

# 5. Ensure the storm is running (on-demand load profile)
echo "==> Ensuring k6 load storm is running..."
RATE="${RATE:-25}" docker compose -p booklogr -f "$STACK/compose/docker-compose.yml" --profile load up -d k6

# 6. Confirm the alert fires (D10 gate)
echo "==> Waiting for alert to fire (timeout=240s)..."
node "$SCRIPTS/confirm-fire.mjs" --timeout=240

# 7. Done
echo "==> armed: incident is live (alert firing under active load)"
