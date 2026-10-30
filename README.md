# Clinic Appointments

Online appointment booking for a doctors' clinic. See [SPEC.md](SPEC.md) for requirements and [CLAUDE.md](CLAUDE.md) for conventions.

## Getting started

Requirements: Node 24 LTS (also in production), Docker Desktop (for local Postgres).

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

## Run everything in Docker (Windows)

For testing the built system without installing Node: only [Docker Desktop](https://www.docker.com/products/docker-desktop/) is needed (WSL 2 backend). From the repo root, in PowerShell or Command Prompt:

```bat
local.cmd start
```

The first run generates `.env.docker` with random secrets, builds the images, migrates and seeds the database, and waits until the app is up. Then open:

- App: http://localhost:8080 (use `localhost`, not `127.0.0.1`, or sign-in fails the origin check)
- Emails: http://localhost:8026 (Mailpit catches all outgoing mail)

Demo logins all use the password `demo-password-not-for-production`: `test.patient@example.test`, `reception@example.test`, `dr.example@example.test`. Staff set up two-step verification on first sign-in, so have an authenticator app ready.

| Command                              | What it does                                                     |
| ------------------------------------ | ---------------------------------------------------------------- |
| `local.cmd start [-NoSeed]`          | Build (if needed) and start; re-seeds demo data unless `-NoSeed` |
| `local.cmd stop`                     | Stop the containers; data is kept                                |
| `local.cmd restart`                  | Stop, rebuild and start (pick up code changes)                   |
| `local.cmd logs [api\|web\|migrate]` | Follow logs                                                      |
| `local.cmd status`                   | List the containers                                              |
| `local.cmd admin you@example.test`   | Create an admin (prompts for a password)                         |
| `local.cmd psql`                     | Open `psql` on the local database                                |
| `local.cmd reset [-Force]`           | Delete the database, demo data and `.env.docker`                 |

It runs alongside the dev setup above, using its own ports (8080, 8026) and Docker project (`clinic-local`). To check the phone layout, open the app in Chrome or Edge and press `Ctrl+Shift+M` for device mode. To test on a real phone, see the note in `docker-compose.local.yml`.

## Colour themes

The site ships with five palettes, defined in `apps/web/src/theme/palettes.css`. Trust & Calm is the default.

| Theme ID                  | Name                  |
| ------------------------- | --------------------- |
| `trust-and-calm`          | Trust & Calm          |
| `warm-and-compassionate`  | Warm & Compassionate  |
| `natural-and-healing`     | Natural & Healing     |
| `uplifting-and-welcoming` | Uplifting & Welcoming |
| `serene-and-professional` | Serene & Professional |

- **Preview** a theme on any page by adding `?theme=<id>` to the URL, e.g. http://localhost:8080/login?theme=natural-and-healing. It lasts until the page is reloaded.
- **Switch the clinic's theme** with the `theme` clinic setting. An admin settings page comes in phase 9; until then, set it in the database:
  ```sql
  INSERT INTO clinic_settings (key, value) VALUES ('theme', '"natural-and-healing"')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  ```
- **Customise** by editing the five `--color-*` values of a theme. Button, link, heading, border and badge shades are derived in `tokens.css`.
- **Check contrast:** `npm test -w @clinic/web` checks every theme against WCAG AA. If a custom palette fails, raise or lower that theme's `--mix-*` knobs in `tokens.css`.

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
