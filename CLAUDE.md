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
- `local.cmd start|stop|restart|reset|logs|status|admin|psql` — the whole system in Docker for testing on Windows (`scripts/local.ps1` + `docker-compose.local.yml`, images in `deploy/local/`). Serves http://localhost:8080, Mailpit on :8026; secrets in a generated, gitignored `.env.docker`. Keep it working: when a phase adds an env var, service or build step, update the compose file and the Dockerfile too. Windows scripts must run in Windows PowerShell 5.1 (no `&&`, ternaries or `??`).

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

## Frontend (phase 4)

- API calls go through `apps/web/src/api/client.ts` (adds CSRF, records activity, global 401/403). Auth screens pass `{ globalErrors: false }` to handle errors inline.
- `AuthProvider` owns sign-in state. **Never `navigate()` after signing out** — call `logout()`/`clearLocal()` and let `RequireAuth` redirect (avoids a race with the query cache).
- Guards: `RequireAuth` (roles, `allowMfaEnrolment`), `PublicOnly`, `HomeRedirect`. Role homes in `HOME_BY_ROLE`; post-login destination via `destinationFor()` (validates `next` with `safeNext`).
- Forms: React Hook Form + shared Zod schemas; map server `VALIDATION_ERROR` with `applyServerErrors`.
- Components in `components/forms.tsx` are labelled and wire errors via `aria-describedby`; keep new inputs on them.
- Tests: `src/test/mockApi.tsx` (`mockApi`, `renderApp`, `meFor`) renders the real route tree in StrictMode with a stubbed `fetch`. Route keys include the query string exactly as the page builds it. `src/test/fixtures.ts` has a full `patientRecord()`.

## Appointments (phase 7)

- `modules/appointments/service.ts`. Scope: patients see their own appointments, doctors their own schedule, reception and admins everything. Anything out of scope is a 404, audited as `appointment.access_denied`. Patients and reception/admin book, reschedule and cancel (`authorizeAny`); doctors don't.
- Booking and rescheduling check that the start is one of `DoctorService.availableSlots()` for that day. That check is only a friendly first pass: the `no_overlap` constraint is what prevents double booking, and `isOverlapViolation` maps it to 409 `SLOT_UNAVAILABLE`. Writes lock the patient row (`SELECT … FOR UPDATE`) so the upcoming-appointment limit and patient overlap check hold under concurrency.
- Status changes follow `STATUS_RULES` in `packages/shared/src/appointments.ts` (roles, from-statuses, timing). The UI's `availableStatusUpdates` mirrors it. Every change writes an `appointment_events` row, and updates are guarded by the current status (a concurrent change gets a 409).
- Patients can't change an appointment within `patientChangeCutoffHours` of its start (409 `CHANGE_WINDOW_CLOSED`). `canChange` on each DTO tells the UI what the caller may do. Patients must have a verified email to book (403 `EMAIL_NOT_VERIFIED`). The upcoming-appointment cap applies to patient self-booking only.
- Clinical notes: doctors only, on their own appointments. They are encrypted with `aad.clinicalNoteBody`, and corrections are new rows with `amendsNoteId` on the same appointment.

## Patients & audit (phase 5)

- Encrypt with `FieldCipher` (`lib/crypto.ts`) using the AAD builders in `lib/aad.ts` (table, column and row ID). Never change an existing AAD string; add a builder for each new `_enc` column. Rows that need an ID in the AAD generate it with `randomUUID()` before insert.
- `req.audit(entry, tx?)` (`middleware/audit.ts`) fills in actor, IP and user agent. Await it before responding; pass the transaction for writes. Audit metadata holds IDs and field names only, never values or search text.
- Doctor access to patients = at least one appointment with them (`PatientService.staffScope`). Out-of-scope records are 404 and audited as `patient.access_denied`.
- Patient responses send `Cache-Control: no-store`. Shared Zod schemas live in `packages/shared/src/patients.ts`: in PATCH bodies, `null`/`''` clears a field and an absent field is left unchanged; inside nested objects, absent fields are normalised to `null`.

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
- Dates: UTC in the DB, `date-fns` + `date-fns-tz` for clinic-timezone logic; never server local time. Use the helpers in `apps/api/src/lib/clinicTime.ts`:
  - `zonedToUtc` resolves clocks-forward gaps forwards and repeated hours to their first occurrence; `fromZonedTime` does neither safely.
  - `addCalendarDays` instead of `date-fns` `addDays`, which uses the server's local zone and loops forever across a DST change on a UK machine.
  - Calendar dates and wall-clock times travel as strings (`2026-11-03`, `09:00`, `2026-11-03T09:00`); instants as UTC ISO strings.
- Slots: `lib/slots.ts` is pure. Any change needs unit tests, including DST cases for Europe/London and America/New_York.
- Frontend: no `dangerouslySetInnerHTML`, no `localStorage`/`sessionStorage` (ESLint enforces both).
- Colours come from the theme, never raw Tailwind palettes:
  - Use `bg-brand`/`text-on-brand` for primary buttons and the header, `text-heading` for h1/h2, `text-link` for links and secondary actions, `bg-accent-soft` for neutral badges and info, `bg-page`/`bg-card` for backgrounds, `text-ink`/`text-ink-muted` for text, and `border-line`/`border-line-strong` for borders.
  - Red, amber and green are only for error, warning and success.
  - Themes live in `apps/web/src/theme/palettes.css` (5 source colours each) and are derived in `tokens.css`. `theme.test.ts` fails if any theme drops below WCAG AA; fix it with that theme's `--mix-*` knobs.
  - The clinic's theme is the `theme` clinic setting; `?theme=<id>` previews one.
- Mobile-friendly is a requirement for every screen. Build mobile-first: the base Tailwind classes target a 360px-wide phone, and `sm:`/`md:` add the wider layout. No horizontal page scrolling. Touch targets are at least 44px (`min-h-11`), and inputs use `text-base` so iOS doesn't zoom. Use one set of markup that reflows (stacked cards on phones, grid or table from `sm` up), not separate mobile and desktop copies. Check new pages at phone width (DevTools device mode) before finishing.
- Cyber Essentials is a requirement (SPEC §11):
  - Keep `docs/CYBER-ESSENTIALS.md` true. Any change to ports, services, runtimes, base images, accounts, auth or uploads updates it in the same change.
  - Only vendor-supported runtimes and images: Node 24 LTS today, never an end-of-life line.
  - High/critical fixes ship within 14 days.
  - MFA stays mandatory for staff. Lockout must trigger after no more than 10 failed attempts.
  - Uploads must be malware-scanned.
- Dependencies: keep `npm audit` clean (high/critical blocks; `npm run check` runs `npm run audit`). `overrides` in root `package.json` pins `deepmerge-ts` ≥ 8 for Prisma 6.
- Conventional commits.
