#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/../docker-compose.test.yml"

cleanup() {
  docker compose -f "${COMPOSE_FILE}" down -v >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Starting postgres + ssh for integration tests..."
docker compose -f "${COMPOSE_FILE}" up -d postgres ssh >/dev/null 2>&1

echo "Running tests..."
docker compose -f "${COMPOSE_FILE}" run --rm --no-deps tests
