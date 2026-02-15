#!/usr/bin/env bash
set -euo pipefail

URL="http://127.0.0.1:8090/"
HEALTH_URL="http://127.0.0.1:8090/health/ready"

for i in {1..60}; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    break
  fi
  sleep 2
done

exec firefox --kiosk --private-window "$URL"
