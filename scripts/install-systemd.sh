#!/usr/bin/env bash
set -euo pipefail

SERVICE_USER="${1:-nanopi}"
INSTALL_DIR="${2:-/opt/nanopi2-dashboard}"
SYSTEMD_DIR="/etc/systemd/system"

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root (sudo)"
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "User does not exist: $SERVICE_USER"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

sed \
  -e "s|^WorkingDirectory=.*$|WorkingDirectory=$INSTALL_DIR|" \
  -e "s|^Environment=DASHBOARD_CONFIG_DIR=.*$|Environment=DASHBOARD_CONFIG_DIR=$INSTALL_DIR/config|" \
  -e "s|^ExecStart=.*$|ExecStart=/usr/bin/node $INSTALL_DIR/src/server.js|" \
  -e "s|^User=.*$|User=$SERVICE_USER|" \
  -e "s|^Group=.*$|Group=$SERVICE_USER|" \
  "$REPO_DIR/deploy/systemd/dashboard-server.service" > "$TMP_DIR/dashboard-server.service"

sed \
  -e "s|^WorkingDirectory=.*$|WorkingDirectory=$INSTALL_DIR|" \
  -e "s|^Environment=HOME=.*$|Environment=HOME=/home/$SERVICE_USER|" \
  -e "s|^ExecStart=.*$|ExecStart=$INSTALL_DIR/deploy/systemd/firefox-kiosk.sh|" \
  -e "s|^User=.*$|User=$SERVICE_USER|" \
  -e "s|^Group=.*$|Group=$SERVICE_USER|" \
  "$REPO_DIR/deploy/systemd/dashboard-kiosk.service" > "$TMP_DIR/dashboard-kiosk.service"

install -m 644 "$TMP_DIR/dashboard-server.service" "$SYSTEMD_DIR/dashboard-server.service"
install -m 644 "$TMP_DIR/dashboard-kiosk.service" "$SYSTEMD_DIR/dashboard-kiosk.service"

systemctl daemon-reload
systemctl enable dashboard-server.service
systemctl enable dashboard-kiosk.service
systemctl restart dashboard-server.service
systemctl restart dashboard-kiosk.service

systemctl --no-pager --full status dashboard-server.service | head -n 20 || true
systemctl --no-pager --full status dashboard-kiosk.service | head -n 20 || true

echo "Installed and restarted dashboard services for user '$SERVICE_USER' with install dir '$INSTALL_DIR'."
