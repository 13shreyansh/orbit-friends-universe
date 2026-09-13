#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
COMPOSE_ARGS=()

cd "$PROJECT_DIR"

if [[ -f .env.production ]]; then
  COMPOSE_ARGS+=(--env-file .env.production)
  echo "[social-cosmos] Using .env.production"
else
  COMPOSE_ARGS+=(--env-file /dev/null)
  echo "[social-cosmos] .env.production not found; using production defaults"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[social-cosmos] Docker is required but was not found." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "[social-cosmos] Docker Compose is required but unavailable." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[social-cosmos] curl is required for the startup health check." >&2
  exit 1
fi

echo "[social-cosmos] Building and starting services..."
docker compose "${COMPOSE_ARGS[@]}" up --build -d --remove-orphans

PORT_MAPPING="$(docker compose "${COMPOSE_ARGS[@]}" port web 80 | head -n 1)"
WEB_PORT="${PORT_MAPPING##*:}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
HEALTH_URL="${WEB_URL}/api/health"

for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt += 1)); do
  if response="$(curl --noproxy '*' --fail --silent --show-error "$HEALTH_URL" 2>/dev/null)" \
    && grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"$response"; then
    echo "[social-cosmos] Ready: ${WEB_URL}/"
    echo "[social-cosmos] Health: ${response}"
    exit 0
  fi
  sleep 1
done

echo "[social-cosmos] Services started, but the API did not become healthy after ${HEALTH_RETRIES}s." >&2
docker compose "${COMPOSE_ARGS[@]}" logs --no-color --tail 80 api web >&2
exit 1
