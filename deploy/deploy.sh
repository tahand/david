#!/usr/bin/env bash
# Deploys a release (SPEC §12.5): fetch, npm ci, build, migrate, restart,
# health check. Rolls the code back if the new release doesn't come up healthy.
#
#   sudo /opt/clinic-app/deploy/deploy.sh [git-ref]     # default: origin/main
#
# Git and npm run as the unprivileged clinicdeploy user, so package install
# scripts never run as root. Migrations are forward-only and are NOT undone by
# a rollback; write them so the previous release still works (expand, then
# contract in a later release).
# -E: the ERR trap (rollback) must also fire for failures inside functions.
set -Eeuo pipefail

REF="${1:-origin/main}"
APP_DIR=/opt/clinic-app
MIGRATE_ENV=/etc/clinic-app/migrate.env
HEALTH_URL=http://127.0.0.1:4000/api/health

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die 'Run as root (sudo).'
[[ -d "$APP_DIR/.git" ]] || die "$APP_DIR is not a git checkout; run deploy/provision.sh first."

# Runs a command as clinicdeploy in the app directory; files stay group-readable
# by clinicapp and unreadable to everyone else.
as_deployer() {
  runuser -u clinicdeploy -- env -C "$APP_DIR" HOME=/var/lib/clinicdeploy \
    bash -c 'umask 027; "$@"' bash "$@"
}

build() {
  log 'Installing dependencies'
  as_deployer npm ci --no-audit --no-fund
  log 'Building'
  as_deployer npm run build
  # Some tools (Prisma copying its engines) keep their own group and mode, so
  # make the whole release readable by the service and nobody else.
  chgrp -R clinicapp "$APP_DIR"
  chmod -R g+rX,g-w,o-rwx "$APP_DIR"
  # Nginx (www-data) serves only the built SPA, which is public anyway: it may
  # pass through the parent folders and read dist, nothing else.
  chmod o+x "$APP_DIR" "$APP_DIR/apps" "$APP_DIR/apps/web"
  chmod -R o+rX "$APP_DIR/apps/web/dist"
}

wait_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

restart() {
  systemctl restart clinic-api
  wait_healthy
}

# Stage 1: work out what to deploy, then run *that release's* copy of this
# script from a temporary file. This script lives inside the checkout it is
# about to replace, and bash reads scripts as it goes, so it must never run
# from a file that `git checkout` rewrites.
if [[ -z "${DEPLOY_TARGET:-}" ]]; then
  log "Fetching $REF"
  as_deployer git fetch --quiet --prune --tags origin
  previous="$(as_deployer git rev-parse HEAD)"
  target="$(as_deployer git rev-parse --verify "$REF^{commit}")" || die "Unknown ref: $REF"
  staged="$(mktemp /tmp/clinic-deploy.XXXXXX)"
  as_deployer git show "$target:deploy/deploy.sh" > "$staged"
  exec env DEPLOY_TARGET="$target" DEPLOY_PREVIOUS="$previous" bash "$staged" "$REF"
fi

# Stage 2, running from the temporary copy.
trap 'rm -f "$0"' EXIT
target="$DEPLOY_TARGET"
previous="$DEPLOY_PREVIOUS"
log "Deploying $(as_deployer git log -1 --format='%h %s' "$target") (was ${previous:0:7})"
as_deployer git checkout --quiet --detach "$target"

rollback() {
  trap - ERR # a failure while rolling back must not recurse
  printf '\nERROR: the new release failed; rolling the code back to %s\n' "${previous:0:7}" >&2
  as_deployer git checkout --quiet --detach "$previous"
  build
  if restart; then
    echo 'Rolled back. The previous release is running. Database migrations were NOT reverted.' >&2
  else
    echo 'Rollback also failed health checks: see journalctl -u clinic-api' >&2
  fi
  exit 1
}
trap rollback ERR

build

log 'Applying database migrations'
# The migrator credentials are root-only and never part of the app's environment.
# shellcheck disable=SC1090
. "$MIGRATE_ENV"
runuser -u clinicdeploy -- env -C "$APP_DIR" HOME=/var/lib/clinicdeploy \
  MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
  node apps/api/scripts/prisma-migrator.mjs migrate deploy

log 'Restarting the API'
restart

log 'Reloading Nginx'
nginx -t
systemctl reload-or-restart nginx

trap - ERR
log "Deployed $(as_deployer git log -1 --format='%h')."
