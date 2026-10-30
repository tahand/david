#!/usr/bin/env bash
# Nightly encrypted database backup (SPEC §12.4), run by clinic-backup.timer.
#
#   1. pg_dump -Fc of the clinic database into a 0700 working directory
#   2. check the dump is readable (pg_restore --list)
#   3. encrypt it with age for the configured recipients; delete the plain copy
#   4. keep KEEP_LOCAL_DAYS days locally; copy off-site to DigitalOcean Spaces
#      and delete remote copies older than KEEP_REMOTE_DAYS
#
# Never writes an unencrypted backup: with no recipient configured it fails.
# Settings: /etc/clinic-app/backup.env (or BACKUP_ENV_FILE).
set -euo pipefail
umask 077

ENV_FILE="${BACKUP_ENV_FILE:-/etc/clinic-app/backup.env}"
# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && . "$ENV_FILE"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/clinic}"
AGE_RECIPIENTS_FILE="${AGE_RECIPIENTS_FILE:-/etc/clinic-app/backup-recipients.txt}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
KEEP_REMOTE_DAYS="${KEEP_REMOTE_DAYS:-30}"
DB_NAME="${DB_NAME:-clinic}"
SPACES_BUCKET="${SPACES_BUCKET:-}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[[ -s "$AGE_RECIPIENTS_FILE" ]] || die "No age recipients in $AGE_RECIPIENTS_FILE; refusing to write an unencrypted backup."
install -d -m 0700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="$DB_NAME-$stamp.dump.age"
work="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
trap 'rm -rf "$work"' EXIT

log "Dumping $DB_NAME"
# pg_dump runs as postgres but streams to stdout, so only root ever writes into
# the root-only backup directory.
runuser -u postgres -- pg_dump --format=custom --compress=6 "$DB_NAME" > "$work/db.dump"
# Reading the archive's table of contents needs no database connection.
pg_restore --list "$work/db.dump" >/dev/null || die 'The dump is not readable; not keeping it.'

log "Encrypting to $BACKUP_DIR/$name"
age --encrypt --recipients-file "$AGE_RECIPIENTS_FILE" --output "$BACKUP_DIR/$name.partial" "$work/db.dump"
mv "$BACKUP_DIR/$name.partial" "$BACKUP_DIR/$name"
(cd "$BACKUP_DIR" && sha256sum "$name" > "$name.sha256")
log "Backup written ($(du -h "$BACKUP_DIR/$name" | cut -f1))"

log "Removing local backups older than $KEEP_LOCAL_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name "$DB_NAME-*.dump.age*" -mtime "+$((KEEP_LOCAL_DAYS - 1))" -print -delete

if [[ -n "$SPACES_BUCKET" ]]; then
  log "Copying off-site to Spaces bucket $SPACES_BUCKET"
  # rclone reads its remote from the environment; nothing is written to disk.
  export RCLONE_CONFIG_SPACES_TYPE=s3
  export RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean
  export RCLONE_CONFIG_SPACES_ENDPOINT="${SPACES_REGION:?Set SPACES_REGION, e.g. lon1}.digitaloceanspaces.com"
  export RCLONE_CONFIG_SPACES_ACCESS_KEY_ID="${SPACES_ACCESS_KEY_ID:?}"
  export RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY="${SPACES_SECRET_ACCESS_KEY:?}"
  export RCLONE_CONFIG_SPACES_ACL=private
  rclone copy --quiet "$BACKUP_DIR/$name" "spaces:$SPACES_BUCKET/clinic/"
  rclone copy --quiet "$BACKUP_DIR/$name.sha256" "spaces:$SPACES_BUCKET/clinic/"
  rclone delete --quiet --min-age "${KEEP_REMOTE_DAYS}d" "spaces:$SPACES_BUCKET/clinic/"
  log 'Off-site copy done'
else
  log 'WARNING: SPACES_BUCKET not set; no off-site copy (SPEC §12.4).'
fi
log 'Backup complete'
