#!/usr/bin/env bash
# Run the TypeScript contract worker + driver against a running engine.
#
# Assumes an Orcher engine is already listening on the gRPC port given by
# ORCHER_SERVER_URL (default http://localhost:50051). This script does not start
# the engine or its Postgres and Redis.
#
# Requires the built SDK + native module (`npm run build` in packages/sdk).
set -euo pipefail

SERVER_URL="${ORCHER_SERVER_URL:-http://localhost:50051}"
PORT="${SERVER_URL##*:}"

cd "$(dirname "$0")/.."

if ! nc -z localhost "$PORT" 2>/dev/null; then
  echo "error: no engine reachable on localhost:$PORT" >&2
  echo "       start the Orcher engine, or set ORCHER_SERVER_URL to where it listens" >&2
  exit 2
fi

exec npx ts-node --project contract/tsconfig.json contract/run.ts "$@"
