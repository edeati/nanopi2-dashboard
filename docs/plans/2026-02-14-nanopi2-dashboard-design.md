# NanoPi2 Dashboard Refactor Design

Date: 2026-02-14

## Goals

- Replace current MagicMirror runtime with a standalone dashboard stack that runs on NanoPi2.
- Keep server and display process decoupled so either can move to different hardware later.
- Support remote LAN administration and local kiosk display.
- Keep full project in git at `/Users/ede020/Private/MagicMirror/Nanopi2-Dashboard` for disaster recovery and portability.
- Run on port `8090` so legacy MagicMirror (`8080`) can run in parallel during migration.

## Constraints and Decisions

- Host: NanoPi2 is the only always-on machine.
- Runtime baseline: Node.js `14.16.0` compatibility required.
- Admin access model: LAN-only admin with password authentication.
- Display runtime: Firefox kiosk mode (not Chromium).
- Config management: both UI-based editing and git-backed config files.
- Git sync model: fully automatic by default, with manual sync controls and status diagnostics in admin UI.
- Branching policy: auto-sync targets `dev` during buildout; promote to `main` for releases.

## Architecture

### Process Split

1. `dashboard-server` (Node 14 service)
- Hosts dashboard UI and admin UI.
- Exposes REST/WebSocket APIs.
- Runs data collectors, rotation scheduler, and git sync jobs.
- Binds to `0.0.0.0:8090`.

2. `dashboard-kiosk` (Firefox service)
- Separate boot/service unit from server.
- Opens local dashboard URL in kiosk mode.
- Uses startup wait/retry against server readiness endpoint.

### Network Endpoints

- Dashboard: `http://192.168.0.27:8090/`
- Admin: `http://192.168.0.27:8090/admin`
- Health: `/health/live`, `/health/ready`

## UX and Screen Model (800x480)

- Hybrid layout:
- Persistent core widgets (clock/date, key weather, key solar, bins, headlines).
- Shared focus pane rotates high-attention modules (e.g., rain radar for 30s).
- Burn-in mitigation via periodic rotation, subtle pixel shift, and low-cost transitions.

## Data Strategy

### Fronius as Primary Source of Truth

- Realtime metrics from Fronius realtime endpoint (generation, grid, load).
- Daily totals and “today so far” from Fronius archive/history APIs.
- Archive requests use Fronius series options including `SeriesType=DailySum` (and detail resolution where required).

### Estimated Fallback Rule

- If archive-derived daily values are unavailable for more than `10 minutes`, system enters estimated mode.
- Estimated mode computes temporary “today so far” from available realtime counters.
- UI must label these values as `Estimated` and show staleness timestamp.
- When archive data recovers, values are replaced by authoritative data and estimated flag clears.

## SQLite Role (Revised)

SQLite is not the primary analytics source.

Use SQLite for:
- Caching last successful payloads for fast cold start.
- Short rolling history for visualizations/outage tolerance.
- Operational metadata (job state, provider health, sync status).
- Optional audit entries (config edits and git sync events).

Do not rely on cumulative-delta SQL as source of truth for daily energy/cost cards.

## Config and Git Model

- Canonical config artifacts in repo files (`config/*.json`, `config/widgets/*.json`, `config/sources/*.json`).
- Admin UI edits config and writes normalized file representations.
- Auto-sync worker performs periodic pull/rebase, commit, and push.
- Admin UI includes:
- Sync status and last success/error.
- Manual actions: Sync now, Pull, Push, Retry, view last error.

## Reliability and Error Handling

- Provider-specific retries with exponential backoff.
- Staleness-first UI semantics:
- Never display silent zero when data is unknown.
- Show explicit unavailable/estimated states with timestamps.
- Kiosk startup race protection:
- Firefox launch waits for `/health/ready` and retries if server not ready.
- Server remains independently accessible on LAN even if kiosk fails.

## Security

- LAN-only exposure for admin endpoints.
- Password login with session cookie and CSRF protection.
- Separate read-only dashboard route and protected admin routes.

## Development and Migration Plan

1. Scaffold new project in `/Users/ede020/Private/MagicMirror/Nanopi2-Dashboard`.
2. Implement Node 14-compatible server skeleton on port 8090.
3. Build base hybrid layout with rotation framework.
4. Integrate Fronius realtime + archive providers and estimated-mode fallback.
5. Add admin auth/config UI and git automation controls.
6. Add systemd units for server and Firefox kiosk.
7. Validate side-by-side against current MagicMirror before cutover.

## Success Criteria

- Dashboard boots reliably on NanoPi2 with Firefox kiosk.
- Admin can manage widgets/layout/sources over LAN.
- Daily solar/usage/cost values come from Fronius archive data and no longer silently zero.
- Auto git sync operates on `dev` with manual override/status.
- Recovery path is verified by cloning repo to another Linux host and running services.
