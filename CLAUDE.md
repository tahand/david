# CLAUDE.md

Doctors online appointment system. `SPEC.md` is the source of truth; build proceeds by the phases in SPEC §14. Treat every **MUST** as a hard requirement.

## Layout

- `packages/shared` — Zod schemas, enums, error codes shared by API and web (`@clinic/shared`).
- `apps/api` — Express 4 + Prisma 6 (PostgreSQL 16). `src/app.ts` is a side-effect-free factory (`createApp(deps)`) used by tests; `src/index.ts` wires real deps.
- `apps/web` — React 18 + Vite + React Router 7 + TanStack Query + Tailwind 4.
- `deploy/`, `docs/` — phase 11.

## Commands (repo root)

- `npm run check` — lint + prettier check + typecheck + tests (run at the end of every phase).
- `npm run dev:api` / `npm run dev:web` — API reads `../../.env` (copy `.env.example`).
- `npm run db:up` — local Postgres 16 via `docker-compose.dev.yml` (dev only).
- `npm run build` — shared → api → web.
- `npm run db:migrate` / `db:seed` — migrations run as `app_migrator` via `apps/api/scripts/prisma-migrator.mjs`; the app and seed run as `app_user`.
- `npm run test:db` — `*.db.test.ts` against `clinic_test` (dev container on port 5433). Never call `prisma migrate reset` from automation; tests must use unique rows instead of relying on a clean DB.

## Database

- Schema in `apps/api/prisma/schema.prisma`. Things Prisma can't express (exclusion constraint, CHECKs, grants, append-only triggers) go in hand-written SQL migrations.
- New tables get SELECT/INSERT/UPDATE for `app_user` via default privileges; grant DELETE explicitly only for ephemeral data. Patients/users are soft-deleted.
- `audit_logs` and `clinical_notes` are append-only (grants + triggers). Corrections to notes are new rows with `amends_note_id`.
- Columns ending `_enc` hold AES-256-GCM envelopes (phase 5); the key version is embedded in the envelope.

## Auth (phase 3)

- Sessions: `modules/auth/sessions.ts` (`__Host-sid`, SHA-256 of the ID stored). `req.auth` = full session, `req.pendingAuth` = awaiting MFA.
- Guards: `requireAuth()` (staff without MFA get 403 `MFA_ENROLMENT_REQUIRED`; pass `{ allowMfaEnrolment: true }` only for enrolment endpoints) and `authorize(permission)` using `ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts`.
- Re-authentication failures inside a session return 400 `INVALID_CREDENTIALS`, never 401 (the SPA treats 401 as "signed out").
- CSRF: signed double-submit (`GET /api/auth/csrf` → `X-CSRF-Token`) plus Origin check on every non-GET.
- Rate limits: `PostgresRateLimiter` (`rate_limits` table). Global 100/min/IP; credential endpoints 5/min/IP; 10 failed logins/hour/account; lockout after 10 consecutive failures.
- Sensitive emails are sent with `sendInBackground` so timing doesn't reveal account existence.
- API tests: `src/test/client.ts` (`TestClient`) handles cookies, CSRF, Origin and a unique IP per client.

## Conventions

- TypeScript `strict`; no `any` without a comment explaining why. ESM everywhere (`.js` suffix on relative imports in API/shared).
- Workspace imports of `@clinic/shared` resolve to `src/` via the `@clinic/source` export condition in dev/tests, and to `dist/` in production builds.
- Business logic in `modules/<name>/service.ts`; HTTP concerns in `routes.ts`; Zod in `schemas.ts`; tests alongside as `*.test.ts`.
- Every endpoint: Zod schema, `authorize()` call, tests for success, validation failure, 401, and 403/404.
- Return 404 (not 403) for records the caller may not know exist.
- Errors: throw `AppError` (`lib/errors.ts`); the error handler emits `{ error: { code, message, details? } }`. Never leak internal messages or stacks.
- Config: add every new env var to `config.ts` (Zod, fail fast) and `.env.example`.
- Logging: `pino` with the redaction list in `lib/logger.ts`. Never log passwords, tokens, session IDs or medical data; extend `SENSITIVE_KEYS` when adding such fields.
- DB: Prisma only; raw SQL only via the `$queryRaw` tagged template.
- Dates: UTC in the DB, `date-fns` + `date-fns-tz` for clinic-timezone logic; never server local time.
- Frontend: no `dangerouslySetInnerHTML`, no `localStorage`/`sessionStorage` (ESLint enforces both).
- Dependencies: keep `npm audit` clean (high/critical blocks). `overrides` in root `package.json` pins `deepmerge-ts` ≥ 8 for Prisma 6.
- Conventional commits.
