#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[check] installing pytest in api container (user site)..."
docker compose --env-file .env.production exec -T -w /app/backend api pip install --user --quiet pytest

echo "[check] ensuring persona test fixture is visible inside the api container..."
docker compose --env-file .env.production exec -T api mkdir -p /app/test/persona/generated
docker cp test/persona/generated/hk-5 social-cosmos-api-1:/app/test/persona/generated/hk-5

echo "[check] running backend pytest..."
docker compose --env-file .env.production exec -T -w /app/backend api python -m pytest -q tests
