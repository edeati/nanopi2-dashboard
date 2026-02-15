#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <password> [config_dir]"
  exit 1
fi

PASSWORD="$1"
CONFIG_DIR="${2:-config}"
AUTH_FILE="$CONFIG_DIR/auth.json"

if [[ ! -d "$CONFIG_DIR" ]]; then
  echo "Config directory does not exist: $CONFIG_DIR"
  exit 1
fi

SALT="$(openssl rand -hex 16)"
ITERATIONS=120000
HASH="$(node -e "const c=require('crypto'); const p=process.argv[1]; const s=process.argv[2]; const i=Number(process.argv[3]); process.stdout.write(c.pbkdf2Sync(p,s,i,64,'sha512').toString('hex'));" "$PASSWORD" "$SALT" "$ITERATIONS")"

cat > "$AUTH_FILE" <<JSON
{
  "adminUser": "admin",
  "passwordSalt": "$SALT",
  "passwordIterations": $ITERATIONS,
  "passwordHash": "$HASH"
}
JSON

chmod 600 "$AUTH_FILE"
echo "Wrote $AUTH_FILE"
