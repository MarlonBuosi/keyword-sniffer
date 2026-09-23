#!/usr/bin/env bash
#
# One-time bootstrap for an Ubuntu 24.04 server (see deploy/AWS.md). Safe to
# re-run. Installs Node, creates the `wa` service user, clones + builds the app
# into /opt/wa-monitor, and installs (but does not start) the systemd unit.
#
# Usage:  sudo bash setup.sh
#   REPO_REF=<branch> sudo -E bash setup.sh    # deploy a branch other than main
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/MarlonBuosi/keyword-sniffer.git}"
REPO_REF="${REPO_REF:-main}"
APP_DIR=/opt/wa-monitor
APP_USER=wa
NODE_MAJOR=24
ENV_FILE=/etc/wa-monitor.env

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

# Run as the app user from / (git refuses to run in a cwd it cannot read, e.g. ~ubuntu).
as_app() { (cd / && sudo -u "$APP_USER" -H "$@"); }

echo "==> swap (2G) — headroom for npm ci on a 1 GB instance"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates

if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  echo "==> Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "node $(node --version)"

echo "==> service user"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --create-home --home-dir /var/lib/wa --shell /usr/sbin/nologin "$APP_USER"
fi

echo "==> app checkout ($REPO_REF)"
if [[ ! -d "$APP_DIR/.git" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
  as_app git clone --branch "$REPO_REF" "$REPO_URL" "$APP_DIR"
else
  as_app git -C "$APP_DIR" fetch --quiet origin
  as_app git -C "$APP_DIR" checkout --quiet "$REPO_REF"
  as_app git -C "$APP_DIR" pull --ff-only --quiet
fi

echo "==> build"
as_app bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"

# The session is a live credential: owner-only. Must exist before the unit
# starts (ReadWritePaths).
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/auth_state"

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 600 /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<'ENV'
# Environment for wa-monitor.service. Restart the service after editing.
#LOG_LEVEL=info
# Only while pairing (bot number, digits only, with country code):
#PAIR_PHONE=5511912345678
ENV
fi

echo "==> systemd unit"
install -m 644 "$APP_DIR/deploy/wa-monitor.service" /etc/systemd/system/wa-monitor.service
systemctl daemon-reload
systemctl enable --quiet wa-monitor

echo
echo "Done. The service is enabled but NOT started."
[[ -f "$APP_DIR/config.json" ]] || echo "  - copy config.json to $APP_DIR/config.json (owner $APP_USER, mode 600)"
echo "  - to pair: set PAIR_PHONE in $ENV_FILE, then: systemctl start wa-monitor"
echo "  - see deploy/AWS.md for the full steps"
