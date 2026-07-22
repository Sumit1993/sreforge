#!/usr/bin/env bash
# =============================================================================
# inject-red-herring.sh — manage compose environment overrides for the
# book-metadata provider error injection.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="$(dirname "$HERE")"
. "$HERE/lib-deploy.sh"

SCENARIO_ID="${1:-${SCENARIO_ID:-}}"
ENV_FILE="$(dirname "$COMPOSE_FILE")/.env"

if [ "$SCENARIO_ID" = "red-herring-coalert" ]; then
  echo "==> Applying red-herring error rate override to book-metadata (SEARCH_STUB_5XX_RATE=0.08)..."
  mkdir -p "$(dirname "$ENV_FILE")"
  if [ -f "$ENV_FILE" ]; then
    grep -v '^SEARCH_STUB_5XX_RATE=' "$ENV_FILE" > "${ENV_FILE}.tmp" || true
    mv "${ENV_FILE}.tmp" "$ENV_FILE"
  fi
  printf 'SEARCH_STUB_5XX_RATE=0.08\n' >> "$ENV_FILE"
  docker compose -p booklogr -f "$COMPOSE_FILE" up -d --force-recreate book-metadata
else
  # arm-regress.sh rm's the compose .env before this runs, so .env cannot tell us
  # whether the LIVE book-metadata container still carries a non-zero rate from a
  # prior red-herring arm. Inspect the container and recreate it against the
  # now-clean .env (=> rate 0) if it is still armed.
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^booklogr-book-metadata$'; then
    cur="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' booklogr-book-metadata 2>/dev/null \
           | grep '^SEARCH_STUB_5XX_RATE=' | cut -d= -f2 || true)"
    if [ -n "$cur" ] && [ "$cur" != "0" ]; then
      echo "==> Clearing stale SEARCH_STUB_5XX_RATE ($cur) on live book-metadata; recreating against clean .env..."
      docker compose -p booklogr -f "$COMPOSE_FILE" up -d --force-recreate book-metadata
    fi
  fi
fi
