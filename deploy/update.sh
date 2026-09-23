#!/usr/bin/env bash
#
# Pull the latest code, rebuild, and restart. Run on the server:
#   sudo /opt/wa-monitor/deploy/update.sh
# or from your machine:
#   ssh wa-monitor 'sudo /opt/wa-monitor/deploy/update.sh'
set -euo pipefail

APP_DIR=/opt/wa-monitor
APP_USER=wa

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

# Run as the app user from / (git refuses to run in a cwd it cannot read, e.g. ~ubuntu).
as_app() { (cd / && sudo -u "$APP_USER" -H "$@"); }

as_app git -C "$APP_DIR" pull --ff-only
as_app bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"

# Pick up unit-file changes shipped with the code.
if ! cmp -s "$APP_DIR/deploy/wa-monitor.service" /etc/systemd/system/wa-monitor.service; then
  install -m 644 "$APP_DIR/deploy/wa-monitor.service" /etc/systemd/system/wa-monitor.service
  systemctl daemon-reload
  echo "unit file updated"
fi

systemctl restart wa-monitor
sleep 3
systemctl --no-pager --lines=0 status wa-monitor
