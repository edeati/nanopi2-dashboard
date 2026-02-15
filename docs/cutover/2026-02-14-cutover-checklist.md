# NanoPi2 Dashboard Cutover Checklist

## 1. Pre-checks

- Confirm old MagicMirror remains on port `8080`.
- Confirm new dashboard branch is checked out on NanoPi.
- Confirm Node runtime available (`node -v` and `npm -v`).
- Run test suite in repo: `npm test`.

## 2. Configure dashboard

- Edit `config/dashboard.json`.
- Set `weather.appid` to your OpenWeather API key.
- Keep `weather.apiBase` as `http://api.openweathermap.org/data/2.5/weather` for old OS compatibility.
- Set `radar.sourceUrl` to a direct radar image endpoint.
- If HTTPS fails due to old cert store, set `insecureTLS` to `true`.

## 3. Create admin auth

- Run: `./scripts/bootstrap-auth.sh '<strong-password>'`
- Verify file exists: `config/auth.json`.
- Verify file permissions: `ls -l config/auth.json` (should be mode `600`).

## 4. Smoke run without systemd

- Start manually: `npm start`.
- From LAN device, open `http://192.168.0.27:8090/`.
- Verify:
  - dashboard loads
  - login works at `/admin`
  - weather shows non-placeholder data
  - radar appears from `/api/radar/image`

## 5. Install services

- Copy repo to target install path (default `/opt/nanopi2-dashboard`) if needed.
- Install units: `sudo ./scripts/install-systemd.sh nanopi /opt/nanopi2-dashboard`
- Verify active services:
  - `systemctl status dashboard-server.service`
  - `systemctl status dashboard-kiosk.service`

## 6. Parallel validation period

- Keep MagicMirror on `8080` and new dashboard on `8090` for at least 24 hours.
- Compare weather/solar/news outputs for regressions.
- Check server logs for provider failures:
  - `journalctl -u dashboard-server.service -n 200 --no-pager`

## 7. Cutover

- Switch local display startup to `http://127.0.0.1:8090/` only.
- Disable old MagicMirror startup service.
- Keep old repo untouched for rollback.

## 8. Rollback plan

- Stop new services:
  - `sudo systemctl stop dashboard-kiosk.service dashboard-server.service`
- Re-enable old MagicMirror startup.
- Reboot and confirm old dashboard on `8080`.

## 9. Post-cutover checks

- Confirm admin access from LAN.
- Confirm git auto-sync status from admin page.
- Confirm no direct third-party calls in browser dev tools network log.
