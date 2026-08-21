# Pool Cleaner Feature Handover

Date: 2026-08-21

This document records the current Beatbot pool cleaner implementation in the NanoPi dashboard so another agent can continue the work without rediscovering the integration.

## Current State

The dashboard has a Beatbot-backed pool cleaner feature for the Sora P3. It is enabled in `config/dashboard.json` and is deployed through the normal homeserver checkout/pull/restart flow.

The current live behavior:

- The pool cleaner appears as a static dashboard card between the bottom strip and the clock.
- It shows the device name, online/active/offline badge, current state label, state icon, battery icon/percentage, mode selector, and supported action buttons.
- While the cleaner is underwater, Beatbot may report `online: false` while still reporting active work states such as `diving`; the dashboard treats those active states as active rather than offline.
- The current user device has been observed as:
  - `name`: `Sora P3`
  - `region`: `eu`
  - `status`: `diving`
  - `workMode`: `fast`
  - `battery`: `59`
  - `supportedActions`: `["return"]`

## Main Files

- `src/lib/beatbot/auth.js`
  - OAuth PKCE flow.
  - Uses Beatbot client id `home-assistant`.
  - Default redirect URI is `https://my.home-assistant.io/redirect/oauth`.
  - Stores pending PKCE state in memory.
  - Persists tokens to `beatbot-tokens.json` in the configured dashboard config dir.
  - Derives Beatbot region from the JWT `region` claim.

- `src/lib/beatbot/client.js`
  - Region-aware REST client.
  - Region bases:
    - `cn`: `https://cn-iot.beatbot.com`
    - `na`: `https://na-iot.beatbot.com`
    - `eu`: `https://eu-iot.beatbot.com`
  - Supports discovery, state fetch, single-device state fetch, and commands.
  - Mirrors the Beatbot Python client envelope behavior, including string/double-encoded payloads.

- `src/lib/beatbot/events.js`
  - Beatbot WebSocket event client.
  - Handles reconnects and token rejection.
  - Used by the service for proactive state updates.

- `src/lib/beatbot/protocol.js`
  - Direct protocol mapping from `beatbot-cloud-python`.
  - Maps raw status integers to keys and labels.
  - Maps pool cleaner error bitmasks to display labels.
  - Defines Beatbot interface names such as `vacuum.state`, `vacuum.battery`, `select.work_mode`, `vacuum.start`, `vacuum.pause`, and `vacuum.return_to_base`.

- `src/lib/beatbot/service.js`
  - Normalizes raw Beatbot devices into dashboard state.
  - Filters discovery to `productCategory === "pool_clean_bot"`.
  - Reconciles periodically through REST.
  - Applies WebSocket events into the raw state cache.
  - Guards commands by checking Beatbot capability metadata.
  - Public commands: `sendStart`, `sendPause`, `sendReturn`, `setWorkMode`, `setChildLock`, `setVoiceDisturb`.

- `src/app.js`
  - HTTP routes for OAuth, admin status, device state, and commands.
  - Relevant endpoints are listed below.

- `src/server.js`
  - Creates the Beatbot service if `dashboardConfig.beatbot.enabled` is true.
  - Bridges service state into `externalState.beatbot`.
  - Syncs Beatbot state into `/api/state` every 5 seconds.

- `public/admin.html`
  - Admin card for Beatbot connect/disconnect/reconcile and device inspection.

- `public/dashboard.html`
  - Static pool cleaner card UI.
  - Important helpers:
    - `buildPoolCleanerCard`
    - `poolCleanerModeLabel`
    - `poolCleanerIsActive`
    - `poolCleanerStateIcon`
    - `renderPoolCleanerStatic`
    - `attachPoolCleanerControls`

- `tests/beatbot.test.js`
  - Protocol, auth, token storage, client parsing, service normalization, and command behavior tests.

- `tests/pool-cleaner-card-layout.test.js`
  - Focused regression test for the small pool cleaner card layout.
  - Checks that the battery label is icon-based, the state icon exists, the status row does not wrap, and mode text is not duplicated when the selector exists.

## Configuration

Current `config/dashboard.json` block:

```json
"beatbot": {
  "enabled": true,
  "label": "Pool Cleaner",
  "oauthRedirectUri": "https://my.home-assistant.io/redirect/oauth",
  "pollIntervalSeconds": 120
}
```

Token storage:

- Local/runtime path is based on the dashboard config dir: `beatbot-tokens.json`.
- On the homeserver this is expected under the mapped config data directory used by the running app.
- Do not commit tokens.

## HTTP API

Auth/admin routes:

- `GET /api/beatbot/auth/start`
  - Auth-required.
  - Redirects to Beatbot OAuth.

- `GET /api/beatbot/auth/callback`
  - OAuth callback.

- `GET /auth/external/callback`
  - Compatibility callback used after Home Assistant style external redirect.

- `GET /api/beatbot/status`
  - Returns `{ authenticated, region, devices }`.

- `POST /api/beatbot/disconnect`
  - Auth-required.
  - Deletes token file and stops the service.

- `POST /api/beatbot/reconcile`
  - Auth-required.
  - Starts an async REST reconcile.

Device routes:

- `GET /api/beatbot/devices`
  - Returns normalized devices from the service cache.

- `GET /api/beatbot/devices/:id`
  - Returns one normalized device.

- `POST /api/beatbot/devices/:id/actions/:action`
  - Auth-required.
  - Supported actions: `start`, `pause`, `return`.

- `PUT /api/beatbot/devices/:id/work-mode`
  - Auth-required.
  - Body: `{ "mode": "fast" }` etc.
  - The value sent by the dashboard is the Beatbot label from the capability option, not the dashboard display label.

- `PUT /api/beatbot/devices/:id/settings/child-lock`
  - Auth-required.
  - Body: `{ "value": true }` or `{ "value": "on" }`.

- `PUT /api/beatbot/devices/:id/settings/voice-disturb`
  - Auth-required.
  - Body: `{ "value": true }` or `{ "value": "on" }`.

## UI Notes

The static card is the active production UI. Beatbot was intentionally removed from the rotating strip as a primary card because the pool cleaner is important enough to keep visible.

Current display labels for modes are dashboard-local:

- `fast` -> `Floor`
- `standard` -> `Floor + Wall`
- `cec` -> `Eco`
- `wall` -> `Waterline`

Current active-state logic in the dashboard treats these as active:

- `diving`
- `cleaning`
- `clean_wait`
- `return_trip`
- `auto_dock`
- `dock`
- `self_cleaning`

This is deliberate because the robot may report offline while underwater.

The latest readability pass changed the small card to:

- Use an icon instead of literal `Battery` text.
- Keep battery in the trailing column with `grid-template-columns: minmax(0, 1fr) auto`.
- Ellipsize long state text instead of wrapping.
- Avoid duplicate mode text when the selector is shown.

## Verification Commands

Local:

```sh
npm test
```

Useful live checks on the homeserver:

```sh
ssh root@homeserver.local 'curl -sS http://127.0.0.1:8090/api/beatbot/status'
ssh root@homeserver.local 'curl -sS http://127.0.0.1:8090/api/state | jq "{beatbot:.beatbot}"'
ssh root@homeserver.local 'docker inspect homedashboard --format "Status={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} RestartCount={{.RestartCount}}"'
```

For UI layout regressions, the current safety net is `tests/pool-cleaner-card-layout.test.js`. It is structural rather than screenshot-based. A likely next improvement is to add a proper component preview or browser/screenshot test for the pool cleaner card at the target small-screen dimensions.

## Live Debugging On Homeserver

SSH access:

```sh
ssh root@homeserver.local
```

Live checkout:

```sh
cd /DATA/AppData/homedashboard/app/nanopi2-dashboard
git status --short --branch
git rev-parse --short HEAD
```

Container and health:

```sh
docker ps --filter name=homedashboard
docker inspect homedashboard --format 'Status={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} RestartCount={{.RestartCount}}'
curl -sS http://127.0.0.1:8090/health/ready
```

Beatbot state checks:

```sh
curl -sS http://127.0.0.1:8090/api/beatbot/status
curl -sS http://127.0.0.1:8090/api/state | jq '{beatbot:.beatbot}'
```

Dashboard page smoke check:

```sh
curl -sS http://127.0.0.1:8090/ | grep -o 'pool-cleaner-battery-icon' | head -1
```

Logs:

```sh
docker logs --tail 200 homedashboard
docker logs -f --tail 100 homedashboard
```

Force a Beatbot REST reconcile from the live app:

```sh
curl -sS -X POST http://127.0.0.1:8090/api/beatbot/reconcile
```

This route is auth-gated in normal browser/API use. If the command is rejected from the shell, inspect through `/api/beatbot/status` first and use the admin page instead.

Restart after code/config changes:

```sh
docker restart homedashboard
```

If `homeserver.local` DNS is flaky from the local Mac, retry the same SSH command after a short wait. Previous sessions saw intermittent mDNS failures, while the service itself was healthy.

## Deployment Flow

Use the repo's normal deployment process:

```sh
git push
ssh root@homeserver.local
cd /DATA/AppData/homedashboard/app/nanopi2-dashboard
git pull --ff-only
docker restart homedashboard
```

Then verify:

```sh
docker inspect homedashboard --format 'Status={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} RestartCount={{.RestartCount}}'
curl -sS http://127.0.0.1:8090/health/ready
curl -sS http://127.0.0.1:8090/api/beatbot/status
```

Do not run `npm install` on the homeserver for normal deploys.

## Known Gaps And Follow-Ups

- Visual card test harness:
  - Current tests catch structural regressions but do not render a screenshot.
  - Good next step: add a deterministic card preview route or fixture and screenshot it at the dashboard tablet size.

- Finishing time:
  - The Beatbot app shows an estimated finish time.
  - The current dashboard does not expose it.
  - It is not yet clear whether the open HA API exposes remaining time directly, or whether the app derives it from state/mode/start time.
  - Investigate raw `/openapi/v1/ha/state`, WebSocket events, and any additional capabilities returned in discovery while a clean is running.

- State coverage:
  - `protocol.js` has the known status map from the Python client.
  - The UI has icons for the common states, but less common states may still use the generic dot icon.

- Online semantics:
  - Underwater cleaning can look offline in Beatbot while still actively reporting `diving`.
  - Keep active-state override behavior unless the API provides a better in-water connectivity signal.

- Command UX:
  - The dashboard currently supports start, pause, return, and work mode when capabilities allow them.
  - The live observed state only exposed `return` while diving.
  - Future work should keep respecting capability metadata instead of hardcoding buttons.

- Admin/auth edge cases:
  - OAuth PKCE state is in memory. If the server restarts during auth, the callback will fail with unknown/expired state.
  - This is acceptable for now, but a persisted short-lived PKCE store would make auth more robust.

- Multiple devices:
  - `buildPoolCleanerCard` currently selects the first Beatbot device from `state.beatbot.devices`.
  - If more than one pool cleaner is added, the UI needs selection or multi-card behavior.

## External References

The implementation was based on these upstream projects:

- `https://github.com/Beatbot-Robotics/beatbot-cloud-python`
- `https://github.com/Beatbot-Robotics/ha_beatbot`

Use those as the first source of truth when expanding protocol support.
