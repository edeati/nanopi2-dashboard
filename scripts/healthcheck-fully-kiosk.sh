#!/usr/bin/env bash
set -euo pipefail

TABLET_SERIAL="${FULLY_KIOSK_TABLET_SERIAL:-192.168.0.29:5555}"
ADB_BIN="${ADB_BIN:-adb}"
MONITOR_ROOT="${FULLY_KIOSK_MONITOR_ROOT:-/tmp/fully-kiosk-monitor}"
MAX_STATUS_AGE_SECONDS="${FULLY_KIOSK_HEALTH_MAX_AGE_SECONDS:-30}"
CURRENT_RUN_FILE="$MONITOR_ROOT/current_run"

if [[ ! "$MAX_STATUS_AGE_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "Health status maximum age must be a positive whole number of seconds" >&2
  exit 64
fi

if [[ ! -r "$CURRENT_RUN_FILE" ]]; then
  echo "Watcher current-run marker is unavailable" >&2
  exit 1
fi

RUN_DIR="$(<"$CURRENT_RUN_FILE")"
STATUS_FILE="$RUN_DIR/status.txt"

if [[ ! -r "$STATUS_FILE" ]]; then
  echo "Watcher status is unavailable" >&2
  exit 1
fi

if ! grep -q '^state=monitoring$' "$STATUS_FILE"; then
  echo "Watcher is not in the monitoring state" >&2
  exit 1
fi

if status_modified_at="$(stat -c %Y "$STATUS_FILE" 2>/dev/null)"; then
  :
elif status_modified_at="$(stat -f %m "$STATUS_FILE" 2>/dev/null)"; then
  :
else
  echo "Could not determine watcher status age" >&2
  exit 1
fi
status_age_seconds=$(( $(date +%s) - status_modified_at ))
if (( status_age_seconds < 0 || status_age_seconds > MAX_STATUS_AGE_SECONDS )); then
  echo "Watcher status is stale (${status_age_seconds}s old)" >&2
  exit 1
fi

if [[ "$("$ADB_BIN" -s "$TABLET_SERIAL" get-state 2>/dev/null || true)" != "device" ]]; then
  echo "Tablet is not reachable through ADB" >&2
  exit 1
fi

printf 'healthy tablet=%s status_age_seconds=%s run_dir=%s\n' \
  "$TABLET_SERIAL" "$status_age_seconds" "$RUN_DIR"
