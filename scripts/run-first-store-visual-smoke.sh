#!/usr/bin/env bash
set -euo pipefail
npm run dev > /tmp/kyrub-e2e-server.log 2>&1 &
server_pid=$!
trap 'mkdir -p artifacts/first-store-visual; cp /tmp/kyrub-e2e-server.log artifacts/first-store-visual/server.log 2>/dev/null || true; kill "$server_pid" 2>/dev/null || true' EXIT
for i in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    echo 'Application health endpoint responded; starting browser smoke'
    timeout 100s node scripts/first-store-visual-smoke.mjs
    exit $?
  fi
  sleep 2
done
cat /tmp/kyrub-e2e-server.log
echo "Isolated app failed to start" >&2
exit 1
