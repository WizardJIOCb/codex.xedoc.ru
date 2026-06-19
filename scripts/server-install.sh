#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/codex.xedoc.ru"
PORT="${PORT:-8797}"
TOKEN_FILE="/root/codex-xedoc.token"
ENV_FILE="/etc/codex-xedoc.env"
SERVICE_FILE="/etc/systemd/system/codex-xedoc.service"

if [ ! -f "$TOKEN_FILE" ]; then
  openssl rand -hex 32 > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

TOKEN="$(cat "$TOKEN_FILE")"

cat > "$ENV_FILE" <<EOF
PORT=$PORT
CODEX_XEDOC_TOKEN=$TOKEN
EOF
chmod 600 "$ENV_FILE"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Codex Xedoc web client
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
User=root
Group=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now codex-xedoc.service
systemctl restart codex-xedoc.service
systemctl --no-pager --full status codex-xedoc.service
