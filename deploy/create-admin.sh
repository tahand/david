#!/usr/bin/env bash
# Creates an admin account on the server (SPEC §3: never via the web).
#
#   sudo /opt/clinic-app/deploy/create-admin.sh admin@example.org
#
# Prompts for the password (12+ characters, checked against breached
# passwords). The admin must set up two-step verification at first sign-in.
set -euo pipefail

EMAIL="${1:?Usage: create-admin.sh <email>}"
APP_DIR=/opt/clinic-app
APP_ENV=/etc/clinic-app/.env
[[ $EUID -eq 0 ]] || { echo 'Run as root (sudo).' >&2; exit 1; }

# Only the database URL is passed on; the app's other secrets aren't needed.
database_url="$(sed -n 's/^DATABASE_URL=//p' "$APP_ENV")"
hibp="$(sed -n 's/^HIBP_CHECK_ENABLED=//p' "$APP_ENV")"
# Without a terminal (automation), the password comes from ADMIN_PASSWORD.
exec runuser -u clinicdeploy -- env -C "$APP_DIR" HOME=/var/lib/clinicdeploy \
  DATABASE_URL="$database_url" HIBP_CHECK_ENABLED="${hibp:-true}" \
  ${ADMIN_PASSWORD:+ADMIN_PASSWORD="$ADMIN_PASSWORD"} \
  npm run --silent create-admin -- --email "$EMAIL"
