#!/usr/bin/env bash
set -euo pipefail

TABLET_SERIAL="${1:-192.168.0.29:5555}"
CHECK_INTERVAL="${2:-5}"
ADB_BIN="${ADB_BIN:-adb}"
MONITOR_ROOT="${FULLY_KIOSK_MONITOR_ROOT:-/tmp/fully-kiosk-monitor}"
PACKAGE_NAME="de.ozerov.fully"
MAIN_PROCESS="de.ozerov.fully"

if [[ ! "$CHECK_INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
  echo "Check interval must be a positive whole number of seconds" >&2
  exit 64
fi

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="$MONITOR_ROOT/$RUN_ID"
STATUS_FILE="$RUN_DIR/status.txt"
RESULT_FILE="$RUN_DIR/result.txt"

mkdir -p "$RUN_DIR"
printf '%s\n' "$RUN_DIR" > "$MONITOR_ROOT/current_run"
printf '%s\n' "$$" > "$RUN_DIR/watcher.pid"

device_state() {
  "$ADB_BIN" -s "$TABLET_SERIAL" get-state 2>/dev/null || true
}

main_pid() {
  "$ADB_BIN" -s "$TABLET_SERIAL" shell ps 2>/dev/null \
    | tr -d '\r' \
    | awk -v process="$MAIN_PROCESS" '$NF == process { print $2; exit }' || true
}

foreground_activity() {
  "$ADB_BIN" -s "$TABLET_SERIAL" shell dumpsys activity activities 2>/dev/null \
    | awk '/mResumedActivity:/ { print; exit }' \
    | tr -d '\r' || true
}

write_status() {
  local state="$1"
  local pid="$2"
  local foreground="$3"
  local pending_status="$STATUS_FILE.pending"

  {
    printf 'checked_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'state=%s\n' "$state"
    printf 'baseline_pid=%s\n' "$BASELINE_PID"
    printf 'observed_pid=%s\n' "$pid"
    printf 'foreground=%s\n' "$foreground"
  } > "$pending_status"
  mv "$pending_status" "$STATUS_FILE"
}

notify_user() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -e \
      'display notification "Crash evidence is ready. Return to the Codex tablet task." with title "Fully Kiosk monitor"' \
      >/dev/null 2>&1 || true
  fi
}

capture_evidence() {
  local reason="$1"
  local observed_pid="${2:-}"
  local captured_at
  captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  {
    printf 'captured_at_utc=%s\n' "$captured_at"
    printf 'serial=%s\n' "$TABLET_SERIAL"
    printf 'reason=%s\n' "$reason"
    printf 'baseline_pid=%s\n' "$BASELINE_PID"
    printf 'observed_pid=%s\n' "$observed_pid"
    printf 'run_dir=%s\n' "$RUN_DIR"
  } > "$RUN_DIR/result.pending"

  {
    printf '=== host time ===\n'
    date -u
    printf '\n=== adb devices ===\n'
    "$ADB_BIN" devices -l || true
    printf '\n=== tablet time and uptime ===\n'
    "$ADB_BIN" -s "$TABLET_SERIAL" shell date || true
    "$ADB_BIN" -s "$TABLET_SERIAL" shell cat /proc/uptime || true
    printf '\n=== Fully processes ===\n'
    "$ADB_BIN" -s "$TABLET_SERIAL" shell ps \
      | awk -v package="$PACKAGE_NAME" '$NF ~ package { print }' || true
    printf '\n=== foreground activity ===\n'
    "$ADB_BIN" -s "$TABLET_SERIAL" shell dumpsys activity activities \
      | awk '/mResumedActivity:|mFocusedActivity:/' || true
    printf '\n=== Fully process priority ===\n'
    "$ADB_BIN" -s "$TABLET_SERIAL" shell dumpsys activity processes "$PACKAGE_NAME" || true
    printf '\n=== system memory ===\n'
    "$ADB_BIN" -s "$TABLET_SERIAL" shell cat /proc/meminfo || true
    printf '\n=== Fully memory ===\n'
    "$ADB_BIN" -s "$TABLET_SERIAL" shell dumpsys meminfo "$PACKAGE_NAME" || true
  } > "$RUN_DIR/snapshot.log" 2>&1

  "$ADB_BIN" -s "$TABLET_SERIAL" logcat -b events -d -v threadtime \
    -s am_proc_died:I am_low_memory:I am_crash:I am_anr:I am_kill:I \
    am_proc_start:I am_focused_activity:I \
    > "$RUN_DIR/events.log" 2>&1 || true

  "$ADB_BIN" -s "$TABLET_SERIAL" logcat -b main -b system -d -v threadtime \
    -s ActivityManager:I AndroidRuntime:E chromium:W DEBUG:E \
    lowmemorykiller:I lmkd:I \
    > "$RUN_DIR/system.log" 2>&1 || true

  mv "$RUN_DIR/result.pending" "$RESULT_FILE"
  notify_user
  printf 'Evidence captured in %s (%s)\n' "$RUN_DIR" "$reason"
}

stop_monitor() {
  printf 'stopped_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$STATUS_FILE"
  exit 0
}
trap stop_monitor INT TERM

CONSECUTIVE_ADB_FAILURES=0

if [[ "$(device_state)" != "device" ]]; then
  "$ADB_BIN" connect "$TABLET_SERIAL" >/dev/null 2>&1 || true
fi

BASELINE_PID="$(main_pid)"
if [[ -z "$BASELINE_PID" ]]; then
  echo "Fully Kiosk main process is not running on $TABLET_SERIAL" >&2
  exit 1
fi

write_status "monitoring" "$BASELINE_PID" "$(foreground_activity)"
printf 'Monitoring %s on %s (PID %s) every %ss; evidence directory: %s\n' \
  "$PACKAGE_NAME" "$TABLET_SERIAL" "$BASELINE_PID" "$CHECK_INTERVAL" "$RUN_DIR"

while true; do
  if [[ "$(device_state)" != "device" ]]; then
    CONSECUTIVE_ADB_FAILURES=$((CONSECUTIVE_ADB_FAILURES + 1))
    "$ADB_BIN" connect "$TABLET_SERIAL" >/dev/null 2>&1 || true

    if (( CONSECUTIVE_ADB_FAILURES >= 2 )); then
      capture_evidence "adb-unavailable-two-consecutive-checks"
      exit 2
    fi

    write_status "adb-unavailable-once" "" ""
    sleep "$CHECK_INTERVAL"
    continue
  fi

  CONSECUTIVE_ADB_FAILURES=0
  CURRENT_PID="$(main_pid)"

  if [[ -z "$CURRENT_PID" ]]; then
    sleep 1
    CURRENT_PID="$(main_pid)"
    if [[ -z "$CURRENT_PID" ]]; then
      capture_evidence "fully-main-process-missing"
      exit 3
    fi
  fi

  if [[ "$CURRENT_PID" != "$BASELINE_PID" ]]; then
    capture_evidence "fully-main-pid-changed" "$CURRENT_PID"
    exit 4
  fi

  write_status "monitoring" "$CURRENT_PID" "$(foreground_activity)"
  sleep "$CHECK_INTERVAL"
done
