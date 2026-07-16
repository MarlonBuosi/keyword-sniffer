#!/usr/bin/env bash
#
# Back up the Baileys session (auth_state/) so a disk loss means a restart, not
# a re-pair. Creates a timestamped tarball and keeps the most recent 14.
#
# Usage:  ./scripts/backup-auth-state.sh [DEST_DIR]
#   DEST_DIR defaults to ~/wa-monitor-backups
#
# Schedule nightly, e.g. crontab:
#   0 3 * * *  /Users/you/Dev/whatsapp-keyword-monitor/scripts/backup-auth-state.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$PROJECT_DIR/auth_state"
DEST="${1:-$HOME/wa-monitor-backups}"
KEEP=14

if [[ ! -d "$SRC" ]]; then
  echo "no auth_state/ at $SRC — nothing to back up (is the bot paired?)" >&2
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$DEST/auth_state-$STAMP.tar.gz"

tar czf "$ARCHIVE" -C "$PROJECT_DIR" auth_state
echo "backed up -> $ARCHIVE"

# Prune all but the newest $KEEP archives.
ls -1t "$DEST"/auth_state-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
  echo "pruned old backup: $old"
done
