# Clinic Appointments

Online appointment booking for a doctors' clinic. See [SPEC.md](SPEC.md) for requirements and [CLAUDE.md](CLAUDE.md) for conventions.

## Getting started

Requirements: Node 20.12+ (20 LTS in production), Docker Desktop (for local Postgres).

```sh
npm install
cp .env.example .env    # then fill SESSION_SECRET and DATA_ENCRYPTION_KEY
npm run db:up           # Postgres 16 on 127.0.0.1:5433 + Mailpit (dev email UI: http://localhost:8025)
npm run db:migrate      # applies migrations as app_migrator
npm run db:seed         # demo doctors, receptionist, appointment types, fake patients
npm run dev:api         # http://127.0.0.1:4000/api/health
npm run dev:web         # http://localhost:5173
```

The seed prints the shared dev password. No admin is seeded; create one with `npm run create-admin -- --email you@example.test` (prompts for the password). Staff accounts must set up two-step verification at first sign-in.

## Tests

- `npm test` — unit and API tests, no database needed.
- `npm run test:db` — database integration tests against `clinic_test` (needs `npm run db:up`). Migrations are applied automatically; tests use unique rows, so leftover data is harmless.
- `npm run check` — everything: lint, format, type-check, unit and DB tests.

### Test database

To wipe `clinic_test` and start again, run this yourself (it drops all data in that database):

```sh
docker compose -f docker-compose.dev.yml exec postgres \
  psql -U postgres -c "DROP DATABASE clinic_test WITH (FORCE)"
docker compose -f docker-compose.dev.yml exec postgres sh -c \
  "psql -U postgres -v db_name=clinic_test -v migrator_password=app_migrator_dev -v app_password=app_user_dev -f /bootstrap/bootstrap.sql"
```

To reset everything (both dev databases): `docker compose -f docker-compose.dev.yml down -v`, then `npm run db:up`.

## Database roles

| Role           | Used by                                | Rights                                                                                              |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `app_migrator` | `prisma migrate deploy` only           | Owns the schema                                                                                     |
| `app_user`     | The Node app (`DATABASE_URL`)          | SELECT/INSERT/UPDATE; DELETE only on ephemeral tables; append-only on audit logs and clinical notes |
| `postgres`     | Bootstrap (`deploy/sql/bootstrap.sql`) | Never used by the app                                                                               |
