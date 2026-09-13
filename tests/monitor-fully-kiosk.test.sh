#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MONITOR="$REPO_ROOT/scripts/monitor-fully-kiosk.sh"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

make_stubs() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/adb" <<'STUB'
#!/usr/bin/env bash
set -u

counter() {
  local name="$1"
  local file="$STUB_STATE/$name"
  local value=0
  if [[ -f "$file" ]]; then
    value="$(<"$file")"
  fi
  value=$((value + 1))
  printf '%s\n' "$value" > "$file"
  printf '%s\n' "$value"
}

if [[ "${1:-}" == "devices" ]]; then
  printf 'List of devices attached\n%s\tdevice\n' "$TEST_SERIAL"
  exit 0
fi

if [[ "${1:-}" == "connect" ]]; then
  exit 0
fi

if [[ "${1:-}" != "-s" ]]; then
  exit 0
fi
shift 2

if [[ "${1:-}" == "get-state" ]]; then
  call="$(counter get_state)"
  if [[ "$STUB_SCENARIO" == "adb_unavailable" && "$call" -gt 1 ]]; then
    exit 1
  fi
  printf 'device\n'
  exit 0
fi

if [[ "${1:-}" == "shell" && "${2:-}" == "ps" ]]; then
  call="$(counter ps)"
  printf 'USER PID PPID VSIZE RSS WCHAN PC NAME\n'
  case "$STUB_SCENARIO:$call" in
    transient_ps:1|transient_ps:3|missing:1|adb_unavailable:1)
      printf 'u0_a1 100 1 1 1 ffffffff 0 de.ozerov.fully\n'
      ;;
    transient_ps:2)
      exit 1
      ;;
    transient_ps:4)
      printf 'u0_a1 200 1 1 1 ffffffff 0 de.ozerov.fully\n'
      ;;
  esac
  exit 0
fi

exit 0
STUB

  cat > "$bin_dir/curl" <<'STUB'
#!/usr/bin/env bash
set -u
while (( $# > 0 )); do
  if [[ "$1" == "--data-binary" ]]; then
    printf '%s\n' "$2" > "$STUB_STATE/slack_payload"
    shift 2
    continue
  fi
  shift
done
cat >/dev/null
STUB

  cat > "$bin_dir/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

  chmod +x "$bin_dir/adb" "$bin_dir/curl" "$bin_dir/sleep"
}

run_case() {
  local scenario="$1"
  local expected_exit="$2"
  local expected_reason="$3"
  local case_root="$TEST_ROOT/$scenario"
  local bin_dir="$case_root/bin"
  local monitor_root="$case_root/evidence"
  local webhook_file="$case_root/webhook"
  local status
  local result_file

  mkdir -p "$case_root/state" "$monitor_root"
  make_stubs "$bin_dir"
  printf 'https://hooks.slack.com/services/test/test/test\n' > "$webhook_file"

  set +e
  PATH="$bin_dir:$PATH" \
    STUB_STATE="$case_root/state" \
    STUB_SCENARIO="$scenario" \
    TEST_SERIAL="test-tablet:5555" \
    ADB_BIN="$bin_dir/adb" \
    FULLY_KIOSK_MONITOR_ROOT="$monitor_root" \
    FULLY_KIOSK_EVIDENCE_DISPLAY_ROOT="$monitor_root" \
    FULLY_KIOSK_ADB_FAILURE_THRESHOLD=3 \
    FULLY_KIOSK_PROCESS_MISSING_THRESHOLD=3 \
    SLACK_WEBHOOK_URL_FILE="$webhook_file" \
    "$MONITOR" "test-tablet:5555" 1 > "$case_root/output.log" 2>&1
  status=$?
  set -e

  [[ "$status" -eq "$expected_exit" ]] || \
    fail "$scenario exited $status, expected $expected_exit; see $case_root/output.log"

  result_file="$(<"$monitor_root/current_run")/result.txt"
  [[ -f "$result_file" ]] || fail "$scenario did not create result.txt"
  rg -q "^reason=${expected_reason}$" "$result_file" || \
    fail "$scenario result did not contain reason=$expected_reason"

  if [[ "$scenario" == "transient_ps" ]]; then
    ! rg -q '^reason=fully-main-process-missing$' "$result_file" || \
      fail "transient process-query failure was misclassified as a missing process"
  fi

  [[ -f "$case_root/state/slack_payload" ]] || \
    fail "$scenario did not render a Slack payload"
  rg -q 'Fully Kiosk monitor alert' "$case_root/state/slack_payload" || \
    fail "$scenario Slack payload did not use generic monitor-alert wording"
  ! rg -q 'exit detected' "$case_root/state/slack_payload" || \
    fail "$scenario Slack payload incorrectly described every event as an exit"

  printf 'PASS: %s -> %s\n' "$scenario" "$expected_reason"
}

run_case transient_ps 4 fully-main-pid-changed
run_case missing 3 fully-main-process-missing
run_case adb_unavailable 2 adb-unavailable-3-consecutive-checks

printf 'All Fully Kiosk monitor regression tests passed.\n'
