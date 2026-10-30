#!/usr/bin/env bash
# Restores an encrypted backup made by backup.sh (docs/RESTORE.md).
#
#   # Test restore into a scratch database (safe; do this monthly):
#   sudo deploy/restore.sh /var/backups/clinic/clinic-20261101T021500Z.dump.age \
#        --identity /root/clinic-backup-key.txt --target clinic_restore_test
#
#   # Replace the live database (stops the API first):
#   sudo deploy/restore.sh <file> --identity <key> --target clinic --replace-live
#
# The database roles (app_migrator, app_user) must exist: on a new server run
# deploy/provision.sh first. Restoring a backup needs the same
# DATA_ENCRYPTION_KEY the data was written with, or encrypted fields can't be read.
set -euo pipefail
umask 077

FILE=''
IDENTITY=''
TARGET=clinic_restore_test
REPLACE_LIVE=false
KEEP=false

usage() { sed -n '2,14p' "$0"; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --identity) IDENTITY="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --replace-live) REPLACE_LIVE=true; shift ;;
    --keep) KEEP=true; shift ;;
    -h|--help) usage ;;
    *)
      if [[ -n "$FILE" ]]; then usage; fi
      FILE="$1"
      shift
      ;;
  esac
done
log() { printf '==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die 'Run as root (sudo).'
[[ -f "$FILE" ]] || usage
[[ -f "$IDENTITY" ]] || die 'Pass --identity <age identity file> (the private backup key).'
[[ "$TARGET" =~ ^[a-z_][a-z0-9_]*$ ]] || die "Bad database name: $TARGET"
if [[ "$TARGET" == clinic && "$REPLACE_LIVE" != true ]]; then
  die 'Restoring over the live database needs --replace-live.'
fi

if [[ -f "$FILE.sha256" ]]; then
  log 'Checking the checksum'
  (cd "$(dirname "$FILE")" && sha256sum --check --quiet "$(basename "$FILE").sha256")
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chown postgres "$work"

log 'Decrypting'
age --decrypt --identity "$IDENTITY" --output "$work/db.dump" "$FILE"
chown postgres "$work/db.dump"
runuser -u postgres -- pg_restore --list "$work/db.dump" >/dev/null || die 'Not a valid dump.'

psql_admin() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtAX "$@"; }

if [[ "$TARGET" == clinic ]]; then
  log 'Stopping the API'
  systemctl stop clinic-api 2>/dev/null || true
fi

log "Recreating database $TARGET"
psql_admin -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET\" WITH (FORCE)"
psql_admin -d postgres -c "CREATE DATABASE \"$TARGET\" OWNER app_migrator ENCODING 'UTF8'"
psql_admin -d postgres -c "REVOKE ALL ON DATABASE \"$TARGET\" FROM PUBLIC"
psql_admin -d postgres -c "GRANT CONNECT, TEMPORARY ON DATABASE \"$TARGET\" TO app_user"

log 'Restoring'
# Ownership and grants come from the dump, so app_user keeps exactly its
# least-privilege rights (including append-only audit logs).
runuser -u postgres -- pg_restore --exit-on-error --single-transaction \
  --dbname="$TARGET" "$work/db.dump"

log 'Checking the restored data'
psql_admin -d "$TARGET" -c "SELECT 'migrations applied: ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
for table in users patients doctors appointments clinical_notes audit_logs; do
  printf '  %-16s %s rows\n' "$table" "$(psql_admin -d "$TARGET" -c "SELECT count(*) FROM $table")"
done
# The double-booking guard and append-only trigger must survive a restore.
psql_admin -d "$TARGET" -c "SELECT 'no_overlap constraint: ' || count(*) FROM pg_constraint WHERE conname = 'no_overlap'"
psql_admin -d "$TARGET" -c "SELECT 'audit trigger: ' || count(*) FROM pg_trigger WHERE tgname = 'audit_logs_append_only'"

if [[ "$TARGET" == clinic ]]; then
  log 'Starting the API'
  systemctl start clinic-api
  log 'Live database restored.'
elif [[ "$KEEP" != true ]]; then
  psql_admin -d postgres -c "DROP DATABASE \"$TARGET\" WITH (FORCE)"
  log "Test restore succeeded; $TARGET dropped (use --keep to inspect it)."
else
  log "Test restore succeeded; $TARGET kept for inspection."
fi
