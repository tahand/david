-- Creates the login roles and an application database (SPEC §8).
-- Run as the postgres superuser. Idempotent; re-running resets passwords.
--
--   psql -v ON_ERROR_STOP=1 \
--        -v db_name=clinic \
--        -v migrator_password="$MIGRATOR_PW" \
--        -v app_password="$APP_PW" \
--        -f bootstrap.sql
--
-- app_migrator owns the schema and is used only by `prisma migrate deploy`.
-- app_user is what the Node app connects as; its table privileges are granted
-- by the migrations themselves.

SELECT 'CREATE ROLE app_migrator LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_migrator') \gexec
ALTER ROLE app_migrator WITH LOGIN NOSUPERUSER NOCREATEROLE PASSWORD :'migrator_password';

SELECT 'CREATE ROLE app_user LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') \gexec
ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD :'app_password';

SELECT format('CREATE DATABASE %I OWNER app_migrator ENCODING ''UTF8''', :'db_name')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db_name') \gexec

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db_name') \gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO app_user', :'db_name') \gexec
SELECT format('GRANT ALL ON DATABASE %I TO app_migrator', :'db_name') \gexec
