#!/usr/bin/env bash
# Idempotent server set-up for the clinic on an Ubuntu 24.04 Droplet
# (SPEC §11, §12). Run as root from a checkout of this repository:
#
#   sudo DOMAIN=appointments.example.org \
#        LETSENCRYPT_EMAIL=it@example.org \
#        ADMIN_USER=clinicadmin \
#        SSH_ALLOW_FROM="203.0.113.10/32" \
#        VOLUME_DEVICE=/dev/disk/by-id/scsi-0DO_Volume_clinic-pgdata \
#        AGE_RECIPIENT=age1... \
#        ./deploy/provision.sh
#
# Safe to re-run: existing secrets, data and certificates are kept. See
# docs/DEPLOYMENT.md for the full procedure.
set -euo pipefail

# --------------------------------------------------------------------- inputs
DOMAIN="${DOMAIN:?Set DOMAIN, e.g. appointments.example.org}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
ADMIN_USER="${ADMIN_USER:-}"
# Space-separated CIDRs allowed to reach SSH; empty = anywhere (not recommended).
SSH_ALLOW_FROM="${SSH_ALLOW_FROM:-}"
# DigitalOcean volume for the Postgres data directory (SPEC §12.1).
VOLUME_DEVICE="${VOLUME_DEVICE:-}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
CLINIC_TIMEZONE="${CLINIC_TIMEZONE:-Europe/London}"
SKIP_CERTBOT="${SKIP_CERTBOT:-false}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/clinic-app
CONFIG_DIR=/etc/clinic-app
PG_VERSION=16
PG_CONF_DIR=/etc/postgresql/$PG_VERSION/main
PG_MOUNT=/mnt/pgdata
PG_DATA_ON_VOLUME=$PG_MOUNT/$PG_VERSION/main
NODE_MAJOR=24

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die 'Run as root (sudo).'
# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || die 'Ubuntu 24.04 LTS is required.'
[[ "$DOMAIN" =~ ^[a-z0-9.-]+$ ]] || die "DOMAIN looks wrong: $DOMAIN"

random_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
# Hex: safe inside a postgresql:// URL without escaping.
random_hex() { openssl rand -hex "$1"; }

export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------ packages
log 'Installing packages'
apt-get update -q
apt-get install -y -q --no-install-recommends \
  ca-certificates curl gnupg git openssl rsync \
  ufw fail2ban unattended-upgrades apt-listchanges \
  nginx certbot \
  "postgresql-$PG_VERSION" "postgresql-client-$PG_VERSION" \
  age rclone \
  clamav clamav-freshclam

# Node.js 24 LTS from NodeSource (Ubuntu's own package is too old).
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]]; then
  log "Installing Node.js $NODE_MAJOR LTS"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get install -y -q nodejs
fi
node --version

# --------------------------------------------------------------------- users
log 'Creating service accounts'
# clinicapp runs the API; it can read the release but not change it.
id clinicapp >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --no-create-home \
  --shell /usr/sbin/nologin clinicapp
# clinicdeploy owns the release and runs npm/git, so install scripts never run as root.
id clinicdeploy >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/clinicdeploy \
  --shell /bin/bash clinicdeploy
usermod -aG clinicapp clinicdeploy

if [[ -n "$ADMIN_USER" ]] && ! id "$ADMIN_USER" >/dev/null 2>&1; then
  log "Creating sudo user $ADMIN_USER with root's SSH keys"
  useradd --create-home --shell /bin/bash --groups sudo "$ADMIN_USER"
  passwd --lock "$ADMIN_USER" >/dev/null # key-only; sudo uses NOPASSWD below
  install -d -m 0700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
  if [[ -s /root/.ssh/authorized_keys ]]; then
    install -m 0600 -o "$ADMIN_USER" -g "$ADMIN_USER" /root/.ssh/authorized_keys \
      "/home/$ADMIN_USER/.ssh/authorized_keys"
  fi
  echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$ADMIN_USER"
  chmod 0440 "/etc/sudoers.d/90-$ADMIN_USER"
  visudo -cf "/etc/sudoers.d/90-$ADMIN_USER" >/dev/null
fi

# ----------------------------------------------------------------------- SSH
# Only lock down SSH once a non-root admin can log in with a key, so this
# script can never lock you out.
admin_has_key=false
if [[ -n "$ADMIN_USER" && -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]]; then admin_has_key=true; fi
if $admin_has_key; then
  log 'Hardening SSH (keys only, no root login)'
  cat > /etc/ssh/sshd_config.d/10-clinic.conf <<'EOF'
# Managed by deploy/provision.sh (SPEC §11).
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
EOF
  sshd -t
  systemctl reload ssh
else
  warn "SSH not hardened: set ADMIN_USER (with an SSH key in root's authorized_keys) and re-run."
fi

# ------------------------------------------------------------------ firewall
log 'Configuring UFW (deny inbound except SSH, HTTP, HTTPS)'
ufw --force default deny incoming
ufw --force default allow outgoing
if [[ -n "$SSH_ALLOW_FROM" ]]; then
  # Replace any open-to-all SSH rule with the allow-list.
  ufw --force delete allow OpenSSH >/dev/null 2>&1 || true
  ufw --force delete allow 22/tcp >/dev/null 2>&1 || true
  for cidr in $SSH_ALLOW_FROM; do ufw allow from "$cidr" to any port 22 proto tcp; done
else
  warn 'SSH is open to any address; set SSH_ALLOW_FROM to your admin IPs.'
  ufw allow 22/tcp
fi
ufw allow 80/tcp
ufw allow 443/tcp
# 5432 is never opened: Postgres listens on localhost only.
ufw --force enable

log 'Configuring fail2ban'
cat > /etc/fail2ban/jail.d/clinic.local <<'EOF'
# Managed by deploy/provision.sh.
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true

[nginx-botsearch]
enabled = true
backend = auto
logpath = /var/log/nginx/access.log

[nginx-limit-req]
enabled = true
backend = auto
logpath = /var/log/nginx/error.log
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log 'Enabling automatic security updates'
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52clinic-unattended-upgrades <<'EOF'
// Managed by deploy/provision.sh. Security updates are on by default in
// 50unattended-upgrades; this adds NodeSource and reboots for kernel fixes
// at a quiet hour.
Unattended-Upgrade::Origins-Pattern {
  "site=deb.nodesource.com";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades

# ----------------------------------------------------------- data volume
if [[ -n "$VOLUME_DEVICE" ]]; then
  log "Mounting $VOLUME_DEVICE at $PG_MOUNT"
  [[ -b "$VOLUME_DEVICE" ]] || die "$VOLUME_DEVICE is not a block device"
  if ! blkid "$VOLUME_DEVICE" >/dev/null 2>&1; then
    # Only a completely blank device is formatted.
    mkfs.ext4 -q -L clinic-pgdata "$VOLUME_DEVICE"
  fi
  uuid="$(blkid -s UUID -o value "$VOLUME_DEVICE")"
  install -d -m 0755 "$PG_MOUNT"
  grep -q "UUID=$uuid" /etc/fstab || echo "UUID=$uuid $PG_MOUNT ext4 defaults,nofail,discard,noatime 0 2" >> /etc/fstab
  mountpoint -q "$PG_MOUNT" || mount "$PG_MOUNT"
else
  warn "VOLUME_DEVICE not set: Postgres data stays on the Droplet's own disk."
fi

# ----------------------------------------------------------------- Postgres
log "Configuring PostgreSQL $PG_VERSION"
if [[ -n "$VOLUME_DEVICE" && ! -d "$PG_DATA_ON_VOLUME" ]]; then
  log "Moving the Postgres data directory to $PG_DATA_ON_VOLUME"
  systemctl stop postgresql
  install -d -o postgres -g postgres -m 0700 "$PG_MOUNT/$PG_VERSION"
  rsync -a "/var/lib/postgresql/$PG_VERSION/main/" "$PG_DATA_ON_VOLUME/"
  chmod 0700 "$PG_DATA_ON_VOLUME"
fi
data_dir_line=''
if [[ -d "$PG_DATA_ON_VOLUME" ]]; then data_dir_line="data_directory = '$PG_DATA_ON_VOLUME'"; fi
cat > "$PG_CONF_DIR/conf.d/10-clinic.conf" <<EOF
# Managed by deploy/provision.sh (SPEC §11).
$data_dir_line
listen_addresses = 'localhost'
password_encryption = 'scram-sha-256'
log_connections = on
log_disconnections = on
log_line_prefix = '%m [%p] %q%u@%d '
EOF
# No trust entries; local superuser via peer auth only; app over TCP loopback with SCRAM.
cat > "$PG_CONF_DIR/pg_hba.conf" <<'EOF'
# Managed by deploy/provision.sh (SPEC §11). No "trust" lines.
# TYPE  DATABASE  USER      ADDRESS        METHOD
local   all       postgres                 peer
local   all       all                      scram-sha-256
host    all       all       127.0.0.1/32   scram-sha-256
host    all       all       ::1/128        scram-sha-256
EOF
chown postgres:postgres "$PG_CONF_DIR/pg_hba.conf" "$PG_CONF_DIR/conf.d/10-clinic.conf"
chmod 0640 "$PG_CONF_DIR/pg_hba.conf"
systemctl enable postgresql
systemctl restart postgresql

# ------------------------------------------------------------------ secrets
log "Writing $CONFIG_DIR (existing secrets are kept)"
install -d -m 0750 -o root -g clinicapp "$CONFIG_DIR"
APP_ENV="$CONFIG_DIR/.env"
MIGRATE_ENV="$CONFIG_DIR/migrate.env"
if [[ ! -f "$MIGRATE_ENV" ]]; then
  # The migrator's password is kept out of the app's environment (least privilege).
  printf 'MIGRATOR_PASSWORD=%s\n' "$(random_hex 24)" > "$MIGRATE_ENV"
fi
chmod 0600 "$MIGRATE_ENV"
chown root:root "$MIGRATE_ENV"
# shellcheck disable=SC1090
. "$MIGRATE_ENV"
MIGRATION_DATABASE_URL="postgresql://app_migrator:${MIGRATOR_PASSWORD}@127.0.0.1:5432/clinic"
grep -q '^MIGRATION_DATABASE_URL=' "$MIGRATE_ENV" \
  || printf 'MIGRATION_DATABASE_URL=%s\n' "$MIGRATION_DATABASE_URL" >> "$MIGRATE_ENV"

if [[ ! -f "$APP_ENV" ]]; then
  app_password="$(random_hex 24)"
  cat > "$APP_ENV" <<EOF
# Clinic API environment (SPEC §13). Managed by deploy/provision.sh; secrets are
# generated once and never overwritten. Losing DATA_ENCRYPTION_KEY makes the
# encrypted patient fields unreadable: keep an offline copy (docs/DEPLOYMENT.md).
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
APP_URL=https://$DOMAIN
LOG_LEVEL=info
DATABASE_URL=postgresql://app_user:${app_password}@127.0.0.1:5432/clinic
SESSION_SECRET=$(random_b64 64)
DATA_ENCRYPTION_KEY=$(random_b64 32)
DATA_ENCRYPTION_KEY_VERSION=1
CLINIC_TIMEZONE=$CLINIC_TIMEZONE
# Fill in your email provider (Postmark, SendGrid, Mailgun...), then
# sudo systemctl restart clinic-api
SMTP_HOST=${SMTP_HOST:-smtp.example.com}
SMTP_PORT=${SMTP_PORT:-587}
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
EMAIL_FROM=${EMAIL_FROM:-Clinic <no-reply@$DOMAIN>}
HIBP_CHECK_ENABLED=true
EOF
fi
chown clinicapp:clinicapp "$APP_ENV"
chmod 0600 "$APP_ENV"
app_password="$(sed -n 's#^DATABASE_URL=postgresql://app_user:\([^@]*\)@.*#\1#p' "$APP_ENV")"
[[ -n "$app_password" ]] || die "Couldn't read the app_user password from $APP_ENV"

log 'Creating database roles and the clinic database'
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q \
  -v db_name=clinic \
  -v migrator_password="$MIGRATOR_PASSWORD" \
  -v app_password="$app_password" \
  -f - < "$REPO_DIR/deploy/sql/bootstrap.sql" # read as root: postgres can't see an admin's home

# ------------------------------------------------------------------ backups
log 'Configuring encrypted backups'
install -d -m 0700 -o root -g root /var/backups/clinic
BACKUP_ENV="$CONFIG_DIR/backup.env"
RECIPIENTS="$CONFIG_DIR/backup-recipients.txt"
if [[ -n "$AGE_RECIPIENT" ]]; then
  grep -qxF "$AGE_RECIPIENT" "$RECIPIENTS" 2>/dev/null || echo "$AGE_RECIPIENT" >> "$RECIPIENTS"
fi
[[ -f "$RECIPIENTS" ]] && chmod 0600 "$RECIPIENTS"
if [[ ! -f "$BACKUP_ENV" ]]; then
  cat > "$BACKUP_ENV" <<EOF
# Backup settings for deploy/backup.sh (SPEC §12.4).
BACKUP_DIR=/var/backups/clinic
AGE_RECIPIENTS_FILE=$RECIPIENTS
KEEP_LOCAL_DAYS=7
# Off-site copy to DigitalOcean Spaces (optional; recommended).
SPACES_BUCKET=
SPACES_REGION=
SPACES_ACCESS_KEY_ID=
SPACES_SECRET_ACCESS_KEY=
KEEP_REMOTE_DAYS=30
EOF
fi
chmod 0600 "$BACKUP_ENV"
[[ -s "$RECIPIENTS" ]] || warn "No backup recipient yet: set AGE_RECIPIENT (see docs/DEPLOYMENT.md). Backups refuse to run unencrypted."

# --------------------------------------------------------------- app layout
log "Preparing $APP_DIR"
# 2751: Nginx may pass through to apps/web/dist (deploy.sh opens only that), not list or read.
install -d -m 2751 -o clinicdeploy -g clinicapp "$APP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  origin="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)"
  if [[ -n "$origin" && "$REPO_DIR" != "$APP_DIR" ]]; then
    # A private repository needs clinicdeploy's deploy key first (docs/DEPLOYMENT.md §5).
    runuser -u clinicdeploy -- git clone --quiet "$origin" "$APP_DIR" \
      || warn "Couldn't clone $origin as clinicdeploy; add its deploy key, clone into $APP_DIR, then re-run."
  else
    warn "Clone the repository into $APP_DIR as clinicdeploy before deploying."
  fi
fi

# ---------------------------------------------------------------- ClamAV
log 'Enabling ClamAV signature updates and daily scans'
systemctl enable --now clamav-freshclam

# ------------------------------------------------------------------ systemd
log 'Installing systemd units'
for unit in clinic-api.service clinic-backup.service clinic-backup.timer \
  clinic-clamscan.service clinic-clamscan.timer; do
  install -m 0644 "$REPO_DIR/deploy/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable clinic-api.service
systemctl enable --now clinic-backup.timer clinic-clamscan.timer

# -------------------------------------------------------------------- Nginx
log 'Configuring Nginx and TLS'
install -d -m 0755 /var/www/certbot
rm -f /etc/nginx/sites-enabled/default
# Don't rely on the package having started it.
systemctl enable nginx
SITE=/etc/nginx/sites-available/clinic
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if [[ ! -f "$CERT" ]]; then
  # Serve only the ACME challenge until a certificate exists.
  cat > "$SITE" <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN;
  server_tokens off;
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 503; }
}
EOF
  ln -sf "$SITE" /etc/nginx/sites-enabled/clinic
  nginx -t && systemctl reload-or-restart nginx
  if [[ "$SKIP_CERTBOT" != true ]]; then
    [[ -n "$LETSENCRYPT_EMAIL" ]] || die 'Set LETSENCRYPT_EMAIL for the TLS certificate.'
    certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
      --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive
  fi
fi
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
if [[ -f "$CERT" ]]; then
  sed "s/__DOMAIN__/$DOMAIN/g" "$REPO_DIR/deploy/nginx.conf" > "$SITE"
  ln -sf "$SITE" /etc/nginx/sites-enabled/clinic
  nginx -t
  systemctl reload-or-restart nginx
  systemctl enable --now certbot.timer
fi

log 'Done.'
cat <<EOF

Next steps (docs/DEPLOYMENT.md):
  1. Edit SMTP settings in $APP_ENV
  2. First release:      sudo $APP_DIR/deploy/deploy.sh origin/main
  3. First admin:        sudo $APP_DIR/deploy/create-admin.sh you@$DOMAIN
  4. Back up offline:    DATA_ENCRYPTION_KEY and SESSION_SECRET from $APP_ENV, and the age identity
  5. Test a restore:     sudo $APP_DIR/deploy/restore.sh <latest backup> --target clinic_restore_test
EOF
