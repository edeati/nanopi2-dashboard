# Fully Kiosk monitor sidecar

This deployment runs the event-driven Fully Kiosk process monitor independently
from the dashboard container. It persists the ADB client identity and captured
evidence across image rebuilds. The monitor retains the 20 newest run directories
by default so evidence cannot grow without a bound. ADB transport failures and
successful process listings that do not contain Fully Kiosk are counted
separately. Each condition must occur three times in succession before the
watcher records evidence and sends an alert, preventing a brief wireless ADB
dropout from being reported as an app exit.

## CasaOS paths

- Evidence: `/DATA/AppData/homedashboard/fully-kiosk-monitor`
- ADB identity: `/DATA/AppData/homedashboard/fully-kiosk-monitor-adb`
- Slack webhook secret: `/DATA/AppData/homedashboard/secrets/fully-kiosk-slack-webhook`

The webhook file must contain only the Slack Incoming Webhook URL and be readable
only by root. The secret is mounted read-only at runtime and is never copied into
the image. The evidence path must remain a dedicated absolute directory because
the monitor applies its bounded-retention policy within that directory.

## Deploy

From the repository root on the CasaOS host:

```sh
docker compose -f deploy/kiosk-monitor/compose.yaml up -d --build
```

The first connection creates a persistent ADB key. Accept the debugging prompt on
the tablet, then restart the container if needed:

```sh
docker restart fully-kiosk-monitor
```

## Verify

```sh
docker inspect fully-kiosk-monitor \
  --format 'Status={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} RestartCount={{.RestartCount}}'
docker exec fully-kiosk-monitor /usr/local/bin/healthcheck-fully-kiosk
docker logs --tail 100 fully-kiosk-monitor
```

Docker reports the container as healthy only when the watcher status is fresh and
the tablet answers a live ADB state check. Health represents current monitoring
and connectivity, not the absence of earlier incidents; completed incident bundles
remain in the evidence directory and their alerts remain in Slack. A
`fully-main-process-missing` event therefore means three successful process
queries found no Fully Kiosk main process. An `adb-unavailable-3-consecutive-checks`
event means the tablet transport or process query failed three times instead.
