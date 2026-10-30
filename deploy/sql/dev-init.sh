#!/bin/bash
# Docker entrypoint init script for local development ONLY (docker-compose.dev.yml).
# Creates the same roles as production with well-known dev passwords, plus a
# separate test database. Production uses deploy/sql/bootstrap.sql with real secrets.
set -euo pipefail

for db in clinic clinic_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v db_name="$db" \
    -v migrator_password=app_migrator_dev \
    -v app_password=app_user_dev \
    -f /bootstrap/bootstrap.sql
done

# `prisma migrate dev` needs a shadow database.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -c "ALTER ROLE app_migrator CREATEDB"
