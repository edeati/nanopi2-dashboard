#!/bin/sh
set -eu
export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"

# Optional: replace old instance if you intentionally keep this behavior
lsof -tiTCP:8090 -sTCP:LISTEN | xargs -r kill || true

# Foreground process (do NOT nohup or &)
exec npm start