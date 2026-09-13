#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_ARGS=()

cd "$PROJECT_DIR"

if [[ -f .env.production ]]; then
  COMPOSE_ARGS+=(--env-file .env.production)
else
  COMPOSE_ARGS+=(--env-file /dev/null)
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[social-cosmos] Docker is required but was not found." >&2
  exit 1
fi

echo "[social-cosmos] Stopping services..."
docker compose "${COMPOSE_ARGS[@]}" down --remove-orphans --timeout "${SHUTDOWN_TIMEOUT:-15}"
echo "[social-cosmos] Stopped. PostgreSQL, Neo4j, and upload volumes were preserved."
