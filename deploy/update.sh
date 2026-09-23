#!/usr/bin/env bash
#
# Deploy a commit from main: build it in isolation, swap it in, restart, and
# verify the bot reconnects. Run on the server:
#   sudo /opt/wa-monitor/deploy/update.sh            # latest origin/main
#   sudo /opt/wa-monitor/deploy/update.sh <sha>      # a specific commit (40 hex chars)
# or from your machine:
#   ssh wa-monitor 'sudo /opt/wa-monitor/deploy/update.sh'
# GitHub Actions runs it with the merge commit via the SSM document
# deploy/ssm/wa-monitor-deploy.json. Rollback = run it with an older main SHA.
set -euo pipefail

APP_DIR=/opt/wa-monitor
APP_USER=wa
BUILD_DIR="$APP_DIR/.build"
UNIT_SRC="$APP_DIR/deploy/wa-monitor.service"
UNIT_DST=/etc/systemd/system/wa-monitor.service
HEALTH_TIMEOUT_S=60

if [[ $EUID -ne 0 ]]; then
  echo "run as root: sudo $0" >&2
  exit 1
fi

# Run as the app user from / (git refuses to run in a cwd it cannot read, e.g. ~ubuntu).
as_app() { (cd / && sudo -u "$APP_USER" -H "$@"); }
git_app() { as_app git -C "$APP_DIR" "$@"; }
die() { echo "error: $*" >&2; exit 1; }

# Everything runs inside main(), which bash parses in full before executing:
# the merge below rewrites this very file mid-run.
main() {
  git_app fetch --quiet origin main

  local target
  if [[ $# -gt 0 ]]; then
    [[ $1 =~ ^[0-9a-f]{40}$ ]] || die "commit must be a full 40-char SHA, got: $1"
    target=$1
  else
    target=$(git_app rev-parse origin/main)
  fi
  git_app cat-file -e "$target^{commit}" 2>/dev/null || die "unknown commit $target"
  git_app merge-base --is-ancestor "$target" origin/main || die "$target is not on main"

  local old
  old=$(git_app rev-parse HEAD)
  if [[ $target != "$old" ]] && git_app merge-base --is-ancestor "$target" "$old"; then
    echo "${target:0:7} is older than the deployed ${old:0:7} — skipping"
    return 0
  fi

  # 1. Build in isolation. A failure here leaves the running bot untouched.
  echo "==> building ${target:0:7}"
  trap 'rm -rf "$BUILD_DIR"' EXIT
  rm -rf "$BUILD_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" "$BUILD_DIR"
  as_app bash -c "git -C '$APP_DIR' archive '$target' | tar -x -C '$BUILD_DIR'"
  as_app bash -c "cd '$BUILD_DIR' && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent"

  # 2. Swap: source first (so a failed fast-forward aborts before touching the
  #    running artifacts), then dist/ and node_modules/ by rename.
  echo "==> swapping in ${target:0:7} (was ${old:0:7})"
  git_app merge --ff-only --quiet "$target"
  rm -rf "$APP_DIR/.dist.old" "$APP_DIR/.node_modules.old"
  local d
  for d in dist node_modules; do
    [[ -e "$APP_DIR/$d" ]] && mv "$APP_DIR/$d" "$APP_DIR/.$d.old"
    mv "$BUILD_DIR/$d" "$APP_DIR/$d"
  done

  if ! cmp -s "$UNIT_SRC" "$UNIT_DST"; then
    install -m 644 "$UNIT_SRC" "$UNIT_DST"
    systemctl daemon-reload
    echo "unit file updated"
  fi

  # 3. Restart and wait for the bot to reconnect to WhatsApp.
  local since
  since=$(date '+%Y-%m-%d %H:%M:%S')
  systemctl restart wa-monitor
  echo "==> waiting up to ${HEALTH_TIMEOUT_S}s for the WhatsApp connection"
  local waited=0
  until journalctl -u wa-monitor --since "$since" -o cat --no-pager | grep -q '"msg":"connection open"'; do
    if systemctl is-failed --quiet wa-monitor || (( waited >= HEALTH_TIMEOUT_S )); then
      systemctl --no-pager --lines=15 status wa-monitor || true
      echo "error: bot did not reconnect after deploying ${target:0:7}." >&2
      echo "roll back with: sudo $APP_DIR/deploy/update.sh $old" >&2
      exit 1
    fi
    sleep 2
    waited=$((waited + 2))
  done

  rm -rf "$APP_DIR/.dist.old" "$APP_DIR/.node_modules.old"
  echo "deployed ${target:0:7} (was ${old:0:7}) — connected after ~${waited}s"
}

main "$@"
exit
