# NanoPi2 Dashboard

Node 14-compatible dashboard server and admin UI for NanoPi2, designed to replace the current MagicMirror runtime while keeping display and server processes decoupled.

## Implemented in this branch

- Server listens on `0.0.0.0:8090`
- Health endpoints: `/health/live`, `/health/ready`
- Dashboard route: `/` with hybrid layout and rotating focus pane
- Admin auth flow: `/login` + protected `/admin`
- Admin APIs:
  - `GET /api/admin/status`
  - `POST /api/admin/config`
  - `POST /api/admin/sync` (`sync`, `pull`, `push`)
- State API: `/api/state`
- Fronius support:
  - realtime polling
  - archive `DailySum` totals
  - estimated fallback mode after 10 minutes without archive refresh
  - configurable polling cadence via `fronius.realtimeRefreshSeconds` and `fronius.archiveRefreshSeconds`
- Weather/news/bins integration:
  - default weather provider is OpenWeather (`weather.provider = openweathermap`)
  - weather requests are server-side only and rate-limited by `weather.refreshSeconds`
  - missing/invalid weather key falls back to non-crashing placeholder status
  - news headlines parsed from RSS feed
  - bins status from configured JSON endpoint
- Radar integration (RainViewer API based):
  - server polls RainViewer metadata API (`radar.apiUrl`)
  - browser only requests local endpoints `/api/radar/meta` and `/api/radar/tile/...`
  - browser also requests local OSM basemap endpoint `/api/map/tile/...`
  - radar is rendered with local map+radar tile compositing at configured lat/lon/zoom
  - smooth transitions controlled by `radar.frameHoldMs` and `radar.transitionMs`
  - refresh interval controlled by `radar.refreshSeconds`
  - map provider template configured in `map.tileUrlTemplate`
- Solar focus visuals:
  - canvas current-generation gauge
  - canvas daily ring summary
  - canvas history chart from server-side realtime history (`solarHistory` in `/api/state`)
- Git sync:
  - manual sync actions via admin API
  - background auto-sync scheduler from config (`git.autoSyncEnabled`, `git.intervalSeconds`)
- Systemd templates for server + Firefox kiosk split

## Old OS TLS compatibility

If HTTPS certificate validation fails due to old CA/cipher support, set:

```json
"insecureTLS": true
```

This allows server-side HTTPS fetches without certificate verification. Use only on trusted networks.

## Repository layout

- `src/` server and runtime logic
- `config/` runtime config files (`auth.json` is local-only)
- `public/` static dashboard/admin pages
- `deploy/systemd/` service templates and kiosk launcher
- `docs/plans/` design and implementation plans

## Development

```bash
npm test
cp config/auth.json.example config/auth.json
# set password hash/salt values in config/auth.json
npm start
```

Optional local secrets in `.env.local`:

```bash
cp .env.example .env.local
# set OPENWEATHER_APPID/OPENWEATHER_APP_ID, OPENWEATHER_LOCATION_ID, RADAR_SOURCE_URL, RADAR_LAT, RADAR_LON
```

`OPENWEATHER_APPID` (or `OPENWEATHER_APP_ID`), `OPENWEATHER_LOCATION_ID`, `RADAR_SOURCE_URL`, `RADAR_LAT`, `RADAR_LON`, and `INSECURE_TLS` from `.env`/`.env.local` override values from `config/dashboard.json`.

Open on LAN:

- Dashboard: `http://192.168.0.27:8090/`
- Admin: `http://192.168.0.27:8090/admin`

## Bootstrap admin auth

```bash
./scripts/bootstrap-auth.sh '<strong-password>'
```

This writes `config/auth.json` with secure file mode `600`.

## NanoPi systemd install

```bash
sudo ./scripts/install-systemd.sh nanopi /opt/nanopi2-dashboard
```

This installer rewrites service templates with your service user/install path, enables both services, and restarts them.

## Cutover checklist

Use:

`docs/cutover/2026-02-14-cutover-checklist.md`

## VS Code remote workflow

Use VS Code Remote SSH from your laptop to `192.168.0.27` and open this repo directly. Keep dashboard server runtime on NanoPi so behavior matches production.
