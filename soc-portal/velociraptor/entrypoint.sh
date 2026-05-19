#!/bin/bash
set -e

CONFIG=/velociraptor/server.config.yaml

echo "[*] Checking Velociraptor config..."
if [ ! -f "$CONFIG" ]; then
  echo "[*] No config found — generating..."
  /usr/local/bin/velociraptor config generate > "$CONFIG"
  # Bind GUI and agent frontends to all interfaces so they're reachable in Docker
  sed -i 's/bind_address: 127\.0\.0\.1/bind_address: 0.0.0.0/g' "$CONFIG"
  echo "[*] Config generated with external bind addresses."
fi

echo "[*] Adding admin user (will no-op if already exists)..."
/usr/local/bin/velociraptor --config "$CONFIG" \
  user add --role=administrator \
  "${VEL_USER:-admin}" "${VEL_PASSWORD:-ChangeThisVelo1!}" || true

echo "[*] Starting Velociraptor frontend..."
exec /usr/local/bin/velociraptor --config "$CONFIG" frontend -v
