# Doctors Online Appointment System — Build Spec for Claude Code

> **How to use this file:** Put it at the repo root as `SPEC.md` and tell Claude Code:
> *"Read SPEC.md and build the system phase by phase (section 14). Stop after each phase, run the tests, and summarise what was done."*
> Claude Code should treat every **MUST** as a hard requirement and every **SHOULD** as the default unless told otherwise.

---

## 1. Overview

A web application where patients register, log in, manage their personal and medical details, and book, reschedule or cancel appointments with doctors. Doctors manage their availability, see their schedule, and record notes against appointments. Clinic administrators manage users, doctors and clinic settings.

### 1.1 Goals
- Secure login for all users, with multi-factor authentication (MFA).
- Online booking against real doctor availability, with no double booking.
- A secure, auditable record of patient details.
- Self-hosted on a single DigitalOcean Droplet with a **local PostgreSQL database** (no managed DB).

### 1.2 Out of scope (v1)
- Video consultations, payments/billing, e-prescribing, integration with external health record systems, native mobile apps. Design so these can be added later.

---

## 2. Tech Stack (MUST)

| Layer | Choice |
|---|---|
| Frontend | React 18 + TypeScript, Vite, React Router, TanStack Query, React Hook Form + Zod, Tailwind CSS |
| Backend | Node.js 20 LTS + TypeScript, Express 4 |
| Database | PostgreSQL 16, installed **locally on the Droplet**, listening on `127.0.0.1` only |
| DB access | Prisma ORM (migrations + typed client). Raw SQL only through Prisma's parameterised `$queryRaw` tagged template |
| Validation | Zod schemas, shared between frontend and backend (`packages/shared`) |
| Auth | Server-side sessions stored in PostgreSQL, httpOnly cookies, Argon2id password hashing, TOTP MFA |
| Email | SMTP via Nodemailer (provider configurable, e.g. Postmark/SendGrid/Mailgun) |
| Testing | Vitest (unit), Supertest (API), Playwright (end-to-end) |
| Process manager | systemd (or PM2) |
| Web server | Nginx reverse proxy + Let's Encrypt TLS (certbot) |
| OS | Ubuntu 24.04 LTS Droplet |

---

## 3. User Roles & Permissions (RBAC)

| Role | Can do |
|---|---|
| **Patient** | Register, log in, manage own profile & medical details, book/reschedule/cancel own appointments, view own appointment history |
| **Doctor** | Log in, manage own availability, view own schedule, view details of patients **with an appointment with them**, add clinical notes to those appointments, mark appointments completed/no-show |
| **Receptionist** | Log in, search patients, create/edit patient records, book/reschedule/cancel appointments for any patient with any doctor. Cannot read clinical notes |
| **Admin** | Everything a receptionist can, plus manage staff accounts and roles, clinic settings, view audit logs. Cannot read clinical notes unless also a doctor |

Rules:
- Permission checks MUST happen on the **server** for every request (frontend hiding is cosmetic only).
- Use a central `authorize(permission)` middleware plus per-record ownership checks (e.g. patient can only read `patient_id = their own`).
- Staff accounts (doctor, receptionist, admin) are created by an admin only — no public signup for staff.
- The first admin is created by a CLI seed command (`npm run create-admin`), never via the web.

---

## 4. Authentication

### 4.1 Methods
1. **Email + password** (primary).
2. **TOTP MFA** (Google Authenticator, Microsoft Authenticator, 1Password, etc.).
   - **Required** for doctor, receptionist and admin roles — they cannot reach any page until MFA is enrolled.
   - **Optional but encouraged** for patients (prompt after first login).
3. **Recovery codes** — 10 one-time codes generated at MFA enrolment, stored hashed.
4. **Email verification** — patients must verify their email before booking.
5. **Password reset via email** — single-use token, 30-minute expiry.
6. *(Optional / phase 2)* "Sign in with Google" for patients via OpenID Connect, behind a feature flag.

### 4.2 Password rules
- Minimum 12 characters, maximum 128. No forced composition rules (per NIST SP 800-63B).
- Reject passwords found in known breach lists (check against the HaveIBeenPwned k-anonymity range API; fail open if the API is down, log a warning).
- Reject passwords containing the user's email.
- Hash with **Argon2id** (`argon2` npm package; memoryCost ≥ 19 MiB, timeCost ≥ 2, parallelism 1).

### 4.3 Sessions
- On successful login (and MFA if enabled), create a row in `sessions` with a random 256-bit ID; store only a **SHA-256 hash** of the ID in the DB.
- Cookie: `__Host-sid`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`.
- Idle timeout: **30 min** for staff, **60 min** for patients. Absolute timeout: **12 hours**.
- Rotate the session ID on login, on MFA completion, and on privilege change.
- Logout destroys the server-side session. "Log out of all devices" option on the account page.
- Changing password or disabling MFA invalidates all other sessions for that user.

### 4.4 Login flow
```
POST /api/auth/login {email, password}
  ├─ invalid → 401 generic "Email or password is incorrect"
  ├─ valid, no MFA → session created → 200 {user}
  └─ valid, MFA enabled → short-lived "pending MFA" session (5 min) → 200 {mfaRequired: true}
        POST /api/auth/mfa/verify {code}  (TOTP or recovery code)
          └─ valid → full session (ID rotated) → 200 {user}
```

### 4.5 Brute-force protection
- Rate limit `/api/auth/*`: 5 attempts per minute per IP, and 10 failed attempts per hour per account.
- After 10 consecutive failures, lock the account for 15 minutes and email the user.
- Store rate-limit counters in PostgreSQL (table `rate_limits`) or in-memory with `rate-limiter-flexible` (Postgres backend preferred so it survives restarts).
- Login responses MUST be identical (message and timing) for "unknown email" and "wrong password". Always run an Argon2 verify against a dummy hash when the user doesn't exist.

### 4.6 CSRF
- Cookie-based sessions → protect all state-changing requests (`POST/PUT/PATCH/DELETE`) with a double-submit CSRF token: `GET /api/auth/csrf` returns a token, frontend sends it in an `X-CSRF-Token` header. Also verify the `Origin` header matches the app origin.

---

## 5. Login Screen & Auth UI

### 5.1 Login page (`/login`)
- Clinic logo + name at top; centred card layout, responsive (works at 360px width).
- Fields: **Email** (type=email, autocomplete=`username`), **Password** (type=password, autocomplete=`current-password`, show/hide toggle).
- **Sign in** button (shows spinner, disabled while submitting).
- Links: "Forgot password?" → `/forgot-password`; "New patient? Create an account" → `/register`.
- Error area (ARIA `role="alert"`) showing the generic error message; lockout message when locked.
- No "remember me" in v1.
- Accessibility: WCAG 2.1 AA — labelled inputs, visible focus, keyboard-only usable, colour contrast ≥ 4.5:1.

### 5.2 MFA screen (`/login/mfa`)
- 6-digit code input (inputmode=numeric, autocomplete=`one-time-code`), auto-submit on 6th digit.
- "Use a recovery code instead" link swaps to a text input.
- "Back to sign in" cancels the pending session.

### 5.3 Other auth screens
- `/register` (patients only): first name, last name, date of birth, email, mobile, password, confirm password, accept privacy notice & terms checkbox (record version + timestamp of consent).
- `/verify-email?token=…` — result page.
- `/forgot-password` — email field; always shows "If an account exists, we've emailed you a link".
- `/reset-password?token=…` — new password + confirm.
- `/account/security` — change password, enable/disable MFA (QR code + manual key + confirm code), regenerate recovery codes, list active sessions with "log out" per session, log out everywhere.
- `/mfa/setup` — forced enrolment screen for staff on first login.

---

## 6. Patient Details

Patients can edit the **contact & demographic** sections themselves; medical sections are editable by doctors and receptionists (patients can view and *request* changes in v1).

### 6.1 Fields

**Personal / demographic**
- Title, first name, middle name(s), last name, preferred name
- Date of birth, sex at birth, gender identity (optional), pronouns (optional)
- National health / insurance identifier (e.g. NHS number or insurance policy number) — configurable label
- Preferred language, interpreter required (bool)

**Contact**
- Email (login email, verified), mobile phone, alternative phone
- Address: line 1, line 2, city, county/state, postcode/ZIP, country
- Preferred contact method (email/SMS/phone), consent to reminders (bool)

**Emergency contact / next of kin**
- Name, relationship, phone, email

**Medical summary**
- Allergies (list: substance, reaction, severity)
- Current medications (list: name, dose, frequency)
- Long-term conditions (list: condition, diagnosed date, notes)
- Registered GP / primary care details (name, practice, phone)
- Accessibility needs (free text)

**Clinical notes** (per appointment, doctors only)
- Free-text note, author, created timestamp. Notes are **append-only**: corrections create an amendment linked to the original; nothing is ever hard-deleted.

**Documents** *(phase 2)* — uploads (PDF/JPG/PNG, ≤10 MB) stored on the Droplet's encrypted volume outside the web root, served only through an authorised API endpoint.

### 6.2 Protection of patient data
- Sensitive columns (national health/insurance ID, medical summary JSON, clinical note text, emergency contact) MUST be encrypted at the application layer with **AES-256-GCM** before storage. Key comes from `DATA_ENCRYPTION_KEY` env var (32 bytes, base64). Store a `key_version` alongside ciphertext to support key rotation.
- Searchable fields (last name, DOB, postcode) remain plaintext but are only queryable by staff.
- Every read and write of patient records is written to `audit_logs` (who, what, when, IP, record ID).
- Patients can download a copy of their data (JSON + PDF) from their account page (data subject access).
- Soft-delete only (`deleted_at`); a retention job (admin-configurable, default per local law, e.g. 8 years) handles permanent erasure.

---

## 7. Appointments

### 7.1 Concepts
- **Appointment types** (admin-managed): name, duration (minutes), colour, whether patients can self-book. E.g. "Standard consultation – 15 min", "Long consultation – 30 min".
- **Availability**: each doctor defines weekly recurring working hours (per weekday, multiple blocks allowed) plus **exceptions** (holidays, sick days, one-off extra sessions).
- **Slots** are computed on the fly from availability minus existing appointments minus exceptions — not stored.

### 7.2 Booking rules
- Patients can book from **1 hour** to **60 days** in advance (both configurable).
- No double booking — enforced **in the database** with an exclusion constraint:
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE appointments ADD CONSTRAINT no_overlap
    EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
    WHERE (status IN ('booked','confirmed','checked_in'));
  ```
- A patient may hold at most **3 future appointments** (configurable).
- Patients can cancel or reschedule up to **24 hours** before (configurable); after that, show "please call the clinic".
- All times stored in UTC (`timestamptz`); displayed in the clinic's timezone (`CLINIC_TIMEZONE`, e.g. `Europe/London`).

### 7.3 Statuses
`booked → confirmed → checked_in → completed`, plus `cancelled_by_patient`, `cancelled_by_clinic`, `no_show`. Every status change is recorded in `appointment_events`.

### 7.4 Notifications (email; SMS optional phase 2)
- Booking confirmation (with .ics calendar attachment), reschedule, cancellation.
- Reminder 24 hours before (scheduled job via `node-cron`, idempotent — record `reminder_sent_at`).
- Emails MUST NOT contain medical details — only date, time, doctor name, clinic address and a link.

---

## 8. Data Model (PostgreSQL)

All tables: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.

| Table | Key columns |
|---|---|
| `users` | email (citext, unique), password_hash, role (enum: patient, doctor, receptionist, admin), email_verified_at, mfa_enabled, mfa_secret_enc, failed_login_count, locked_until, last_login_at, is_active, deleted_at |
| `mfa_recovery_codes` | user_id → users, code_hash, used_at |
| `sessions` | id_hash (unique), user_id, mfa_pending (bool), ip, user_agent, last_seen_at, expires_at |
| `email_tokens` | user_id, type (verify_email / reset_password), token_hash, expires_at, used_at |
| `patients` | user_id → users (nullable — receptionist may create patients without logins), title, first_name, middle_names, last_name, preferred_name, date_of_birth, sex_at_birth, gender_identity, pronouns, health_id_enc, phone_mobile, phone_alt, address fields, preferred_contact, reminder_consent, emergency_contact_enc, medical_summary_enc, gp_details, accessibility_needs, consent_version, consent_at, deleted_at |
| `doctors` | user_id → users (unique), display_name, specialty, registration_number, bio, is_bookable |
| `appointment_types` | name, duration_minutes, colour, patient_bookable, is_active |
| `availability_rules` | doctor_id, weekday (0–6), start_time, end_time, valid_from, valid_to |
| `availability_exceptions` | doctor_id, starts_at, ends_at, type (unavailable / extra), reason |
| `appointments` | patient_id, doctor_id, appointment_type_id, starts_at, ends_at, status, reason_for_visit_enc, booked_by_user_id, cancelled_reason, reminder_sent_at — with `no_overlap` constraint (7.2) and index on (doctor_id, starts_at) |
| `appointment_events` | appointment_id, from_status, to_status, actor_user_id, note |
| `clinical_notes` | appointment_id, patient_id, author_doctor_id, body_enc, amends_note_id (nullable) |
| `audit_logs` | actor_user_id, action, entity_type, entity_id, ip, user_agent, metadata jsonb — **append-only** (revoke UPDATE/DELETE from the app DB role) |
| `clinic_settings` | key (unique), value jsonb |
| `rate_limits` | key, points, expire |

Database roles:
- `app_user` — used by the Node app: SELECT/INSERT/UPDATE on app tables, INSERT-only on `audit_logs`, no DDL.
- `app_migrator` — owns schema, used only by `prisma migrate deploy`.
- `postgres` superuser — never used by the app.

---

## 9. REST API

Base path `/api`. JSON only. All inputs validated with Zod; unknown fields stripped. Errors use a consistent shape: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`. Never return stack traces in production.

**Auth**
| Method | Path | Notes |
|---|---|---|
| GET | /auth/csrf | returns CSRF token |
| POST | /auth/register | patients only |
| POST | /auth/verify-email | {token} |
| POST | /auth/login | |
| POST | /auth/mfa/verify | |
| POST | /auth/logout | |
| POST | /auth/logout-all | |
| POST | /auth/forgot-password | |
| POST | /auth/reset-password | |
| GET | /auth/me | current user + role |
| POST | /auth/mfa/setup | returns otpauth URI + QR (data URL) |
| POST | /auth/mfa/enable | {code} → returns recovery codes once |
| POST | /auth/mfa/disable | requires password + code; not allowed for staff |
| POST | /auth/change-password | requires current password |
| GET / DELETE | /auth/sessions[/:id] | list / revoke sessions |

**Patients**
| Method | Path | Who |
|---|---|---|
| GET / PATCH | /patients/me | patient |
| GET | /patients/me/export | patient (data download) |
| GET | /patients?search= | receptionist, admin, doctor (doctor: only own patients) |
| POST | /patients | receptionist, admin |
| GET / PATCH | /patients/:id | staff (ownership rules apply) |
| PUT | /patients/:id/medical-summary | doctor, receptionist |

**Doctors & availability**
| Method | Path | Who |
|---|---|---|
| GET | /doctors | any logged-in user (public profile fields only) |
| GET | /doctors/:id/slots?from=&to=&typeId= | any logged-in user |
| GET / PUT | /doctors/:id/availability | that doctor, admin |
| POST / DELETE | /doctors/:id/exceptions[/:exId] | that doctor, admin |

**Appointments**
| Method | Path | Who |
|---|---|---|
| GET | /appointments?from=&to=&doctorId=&patientId= | scoped by role |
| POST | /appointments | patient (self), receptionist/admin (any) |
| GET | /appointments/:id | scoped |
| PATCH | /appointments/:id/reschedule | patient (within window), staff |
| PATCH | /appointments/:id/cancel | patient (within window), staff |
| PATCH | /appointments/:id/status | doctor, receptionist |
| GET / POST | /appointments/:id/notes | doctor only |

**Admin**
| Method | Path |
|---|---|
| GET / POST / PATCH | /admin/users[/:id] (create staff, change role, deactivate, force password reset, reset MFA) |
| GET / POST / PATCH | /admin/appointment-types[/:id] |
| GET / PUT | /admin/settings |
| GET | /admin/audit-logs?actor=&entity=&from=&to= |

Booking a slot that was just taken MUST return `409 SLOT_UNAVAILABLE` (catch the exclusion-constraint violation) and the UI must refresh slots.

---

## 10. Frontend Pages

**Public:** `/login`, `/login/mfa`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/privacy`, `/terms`.

**Patient:**
- `/dashboard` — next appointment card, "Book appointment" button, alerts (verify email, enable MFA, complete profile).
- `/book` — 3-step wizard: choose appointment type → choose doctor (or "any doctor") → pick date & slot from a calendar → confirm (with optional reason for visit).
- `/appointments` — upcoming and past; reschedule / cancel actions.
- `/profile` — personal, contact, emergency contact (editable); medical summary (read-only).
- `/account/security`.

**Doctor:**
- `/schedule` — day/week calendar of own appointments; click an appointment → patient summary + notes panel.
- `/patients/:id` — patient details, appointment history, clinical notes (own patients only).
- `/availability` — weekly working hours editor + exceptions list.

**Receptionist:**
- `/front-desk` — all doctors' day view side by side, check-in buttons.
- `/patients` — search (name, DOB, postcode, phone), create patient.
- `/patients/:id` — edit details, book on their behalf.

**Admin:** `/admin/users`, `/admin/appointment-types`, `/admin/settings`, `/admin/audit-logs`.

General UI requirements:
- Route guards by role; redirect unauthenticated users to `/login?next=…` (validate `next` is a relative path to avoid open redirects).
- Show an inactivity warning modal 2 minutes before session timeout with "Stay signed in".
- Global 401 handler → redirect to login; 403 → "You don't have access" page.
- Never store tokens or patient data in `localStorage`/`sessionStorage`. TanStack Query cache is cleared on logout.
- Responsive, WCAG 2.1 AA.

---

## 11. Security Requirements (MUST)

Follow the **OWASP ASVS Level 2** and **OWASP Top 10** as the baseline.

**Transport & headers**
- HTTPS only (Let's Encrypt via certbot, auto-renew). HTTP → HTTPS redirect. HSTS `max-age=31536000; includeSubDomains`.
- `helmet` with a strict Content-Security-Policy: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/mic/geolocation.
- CORS: frontend and API are served from the **same origin** (Nginx serves the React build and proxies `/api`), so CORS is disabled.

**Application**
- All input validated with Zod on the server; output encoded by React (never use `dangerouslySetInnerHTML`).
- Only parameterised queries (Prisma). No string-concatenated SQL.
- Authorisation checks on every endpoint + object-level ownership checks (prevent IDOR). Write tests for this.
- Request body size limit 100 KB (10 MB on upload route only).
- Global rate limit 100 req/min per IP; stricter on auth routes (4.5).
- Generic error messages to clients; detailed errors to logs only.
- Dependencies: `npm audit` in CI, Dependabot/Renovate enabled, lockfiles committed.
- Secrets only in env vars (`/etc/clinic-app/.env`, mode 600, owned by the service user). Never commit `.env`. Provide `.env.example`.

**Data**
- Field-level AES-256-GCM encryption for sensitive data (6.2).
- DigitalOcean **Volume** for the Postgres data directory; enable full-disk encryption at rest (DO volumes are encrypted at rest by default; document this).
- Logs MUST NOT contain passwords, tokens, session IDs, or patient medical data. Use `pino` with a redaction list.
- Audit log for: login success/failure, logout, MFA changes, password changes, every patient record view/edit, every clinical note view/create, appointment changes, admin actions.

**Server hardening (Droplet)**
- Non-root sudo user; SSH key auth only; `PermitRootLogin no`; `PasswordAuthentication no`.
- UFW: allow only 22 (ideally restricted to admin IPs), 80, 443. **Port 5432 is never exposed.** Also apply a DigitalOcean Cloud Firewall with the same rules.
- `fail2ban` for SSH and Nginx.
- `unattended-upgrades` for security patches.
- PostgreSQL: `listen_addresses = 'localhost'`, `pg_hba.conf` uses `scram-sha-256` for local TCP connections, no `trust` entries.
- Node app runs as a dedicated unprivileged `clinicapp` system user via systemd with `NoNewPrivileges=true`, `ProtectSystem=strict`, `PrivateTmp=true`.

**Compliance**
- Design to support GDPR / UK GDPR (and HIPAA-style safeguards if used in the US): consent recording, data export, retention & erasure, audit trail, least-privilege access. Note: final legal compliance (e.g. signed agreements with the hosting/email provider, DPIA) is the clinic's responsibility — list these in `docs/COMPLIANCE.md`.

---

## 12. Deployment on DigitalOcean

### 12.1 Infrastructure
- 1 × Droplet, Ubuntu 24.04, minimum 2 vCPU / 4 GB RAM.
- 1 × attached Block Storage Volume (e.g. 50 GB) mounted at `/mnt/pgdata` for PostgreSQL data.
- DigitalOcean Cloud Firewall (22/80/443 inbound only).
- DNS A record → Droplet (reserved IP recommended).
- Optional: DigitalOcean Spaces bucket for **encrypted off-site backups**.

### 12.2 Layout on the server
```
/opt/clinic-app/            # app release (git checkout or rsynced build)
  apps/api/dist/            # compiled Node backend
  apps/web/dist/            # built React static files (served by Nginx)
/etc/clinic-app/.env        # secrets (600, clinicapp:clinicapp)
/etc/nginx/sites-available/clinic
/etc/systemd/system/clinic-api.service
/var/backups/clinic/        # local pg_dump files
```

### 12.3 Nginx
- Serve `apps/web/dist` at `/` with SPA fallback to `index.html`; long cache for hashed assets.
- Proxy `/api` → `http://127.0.0.1:4000` with `X-Forwarded-For`/`X-Forwarded-Proto`; Express uses `app.set('trust proxy', 1)`.
- `client_max_body_size 10m`; gzip on; security headers as section 11.

### 12.4 Backups (MUST)
- Nightly `pg_dump -Fc` via cron/systemd timer → encrypted with `age` or `gpg` → kept locally 7 days → copied to DO Spaces (30 days retention).
- Also enable DigitalOcean Droplet backups/snapshots weekly.
- Document and **test** the restore procedure in `docs/RESTORE.md`.

### 12.5 Deliverables for deployment
- `deploy/provision.sh` — idempotent server setup script (users, packages, Postgres 16, Node 20, Nginx, certbot, UFW, fail2ban, volume mount).
- `deploy/nginx.conf`, `deploy/clinic-api.service`, `deploy/backup.sh`.
- `deploy/deploy.sh` — pull, `npm ci`, build, `prisma migrate deploy`, restart service, health check.
- Health endpoint `GET /api/health` (checks DB connectivity, returns no sensitive info).
- `docs/DEPLOYMENT.md` — step-by-step guide.
- Optional: GitHub Actions workflow to run tests and deploy over SSH on merge to `main`.

---

## 13. Project Structure

npm workspaces monorepo:
```
/
├─ SPEC.md
├─ CLAUDE.md                 # short conventions summary for Claude Code
├─ package.json              # workspaces
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ app.ts           # express app factory (for tests)
│  │  │  ├─ config.ts        # env loading + validation with Zod (fail fast)
│  │  │  ├─ middleware/      # auth, authorize, csrf, rateLimit, errorHandler, audit
│  │  │  ├─ modules/
│  │  │  │  ├─ auth/  patients/  doctors/  appointments/  admin/
│  │  │  │  │   (each: routes.ts, service.ts, schemas.ts, *.test.ts)
│  │  │  ├─ lib/             # crypto.ts (AES-GCM), email.ts, slots.ts, logger.ts
│  │  │  └─ jobs/            # reminders.ts, retention.ts, sessionCleanup.ts
│  │  ├─ prisma/schema.prisma + migrations/ + seed.ts
│  │  └─ scripts/create-admin.ts
│  └─ web/
│     └─ src/
│        ├─ main.tsx  App.tsx  router.tsx
│        ├─ api/             # fetch client (adds CSRF header, handles 401/403)
│        ├─ auth/            # AuthProvider, RequireRole, session timeout
│        ├─ pages/           # grouped by role
│        └─ components/
├─ packages/shared/          # Zod schemas + shared types + enums
├─ deploy/
├─ docs/
└─ docker-compose.dev.yml    # local Postgres 16 for development only
```

### Environment variables (`.env.example`)
```
NODE_ENV=production
PORT=4000
APP_URL=https://appointments.example.com
DATABASE_URL=postgresql://app_user:CHANGE_ME@127.0.0.1:5432/clinic
MIGRATION_DATABASE_URL=postgresql://app_migrator:CHANGE_ME@127.0.0.1:5432/clinic
SESSION_SECRET=            # 64 random bytes, base64
DATA_ENCRYPTION_KEY=       # 32 random bytes, base64
DATA_ENCRYPTION_KEY_VERSION=1
CLINIC_TIMEZONE=Europe/London
SMTP_HOST= SMTP_PORT=587 SMTP_USER= SMTP_PASS= EMAIL_FROM=
HIBP_CHECK_ENABLED=true
```
`config.ts` MUST refuse to start if any required variable is missing or malformed.

---

## 14. Build Phases (for Claude Code)

Work through these in order. At the end of each phase: run lint, type-check and tests; fix failures; summarise changes.

1. **Scaffold** — monorepo, TypeScript, ESLint + Prettier, Vitest, `docker-compose.dev.yml` Postgres, config validation, logger, error handler, `/api/health`, `CLAUDE.md`.
2. **Database** — Prisma schema for all tables in section 8, migrations (including the `btree_gist` exclusion constraint and DB roles via SQL migration), seed script with demo doctors, appointment types and fake patients (clearly fake data only).
3. **Authentication backend** — register, verify email, login, sessions, CSRF, logout, password reset, rate limiting, lockout, MFA (TOTP via `otplib`) + recovery codes, `create-admin` script. Full tests.
4. **Auth frontend** — login, MFA, register, forgot/reset, account security, forced staff MFA enrolment, route guards, inactivity timeout.
5. **Patients** — encryption helper, patient CRUD, medical summary, data export, audit logging middleware, object-level access tests.
6. **Doctors & availability** — availability rules/exceptions, slot computation (`lib/slots.ts`, heavily unit-tested incl. DST changes), availability UI.
7. **Appointments** — booking, reschedule, cancel, statuses, conflict handling (409), booking wizard, schedule/front-desk views, clinical notes.
8. **Notifications & jobs** — emails + .ics, reminders, session cleanup, retention job.
9. **Admin** — staff management, appointment types, settings, audit log viewer.
10. **Hardening & E2E** — security headers/CSP check, Playwright tests for the main journeys, `npm audit` clean, accessibility check (axe).
11. **Deployment** — `deploy/` scripts, Nginx/systemd configs, backups, `docs/DEPLOYMENT.md`, `docs/RESTORE.md`, `docs/COMPLIANCE.md`.

### Coding conventions
- TypeScript `strict: true`; no `any` without a comment explaining why.
- Business logic in `service.ts`, HTTP concerns in `routes.ts`.
- Every endpoint has: Zod schema, `authorize()` call, tests for success, validation failure, unauthenticated (401) and wrong role/owner (403/404).
- Use 404 (not 403) when a user requests a record they're not allowed to know exists.
- Dates: `date-fns` + `date-fns-tz`; never rely on server local time.
- Conventional commits.

---

## 15. Acceptance Criteria

- [ ] A patient can register, verify email, log in, enable MFA, complete their profile, book, reschedule and cancel an appointment, and receive emails for each.
- [ ] Staff cannot access anything until MFA is enrolled.
- [ ] Two simultaneous bookings for the same slot → exactly one succeeds, the other gets 409.
- [ ] A doctor cannot view a patient they have no appointment with (returns 404) — covered by tests.
- [ ] A receptionist cannot read clinical notes — covered by tests.
- [ ] Sensitive columns are unreadable ciphertext when inspected directly in `psql`.
- [ ] 10 failed logins lock the account; the user is emailed.
- [ ] Every patient record view appears in the audit log.
- [ ] PostgreSQL is not reachable from outside the Droplet (`nmap` shows only 22/80/443).
- [ ] SSL Labs grade A or better; securityheaders.com grade A.
- [ ] Nightly backup runs, and a restore from backup has been tested and documented.
- [ ] All unit, API and E2E tests pass; `npm audit` reports no high/critical issues.

---

## 16. Open Questions (decide before or during build)
1. Country/jurisdiction — affects the health ID label (NHS number vs insurance ID), retention period and compliance wording.
2. SMS reminders needed in v1? (would add a provider such as Twilio)
3. Single clinic or multiple clinic locations?
4. Should patients be able to choose "any available doctor"?
5. Email provider choice.
