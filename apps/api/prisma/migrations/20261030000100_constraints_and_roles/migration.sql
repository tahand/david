-- Hand-written: constraints and privileges Prisma cannot express (SPEC §7.2, §8).

-- ---------------------------------------------------------------------------
-- No double booking (SPEC §7.2). '[)' bounds allow back-to-back appointments.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status IN ('booked', 'confirmed', 'checked_in'));

-- ---------------------------------------------------------------------------
-- Data integrity checks
-- ---------------------------------------------------------------------------
ALTER TABLE appointments
  ADD CONSTRAINT appointments_time_order CHECK (ends_at > starts_at);

ALTER TABLE availability_rules
  ADD CONSTRAINT availability_rules_weekday CHECK (weekday BETWEEN 0 AND 6),
  ADD CONSTRAINT availability_rules_time_order CHECK (end_time > start_time),
  ADD CONSTRAINT availability_rules_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE availability_exceptions
  ADD CONSTRAINT availability_exceptions_time_order CHECK (ends_at > starts_at);

ALTER TABLE appointment_types
  ADD CONSTRAINT appointment_types_duration CHECK (duration_minutes BETWEEN 5 AND 480),
  ADD CONSTRAINT appointment_types_colour CHECK (colour ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE users
  ADD CONSTRAINT users_failed_login_count CHECK (failed_login_count >= 0);

ALTER TABLE clinical_notes
  ADD CONSTRAINT clinical_notes_not_self_amend CHECK (amends_note_id IS NULL OR amends_note_id <> id);

-- ---------------------------------------------------------------------------
-- Append-only tables. Grants below already deny UPDATE/DELETE to app_user;
-- these triggers also stop the schema owner from rewriting history by accident.
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_modification() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

CREATE TRIGGER clinical_notes_append_only
  BEFORE UPDATE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- ---------------------------------------------------------------------------
-- Database roles (SPEC §8). Login roles and passwords are created out of band
-- by deploy/sql/bootstrap.sql; this only guarantees app_user exists so the
-- grants below succeed (e.g. on Prisma's shadow database).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user;

-- Baseline: read, insert and update; no DDL, no TRUNCATE, no DELETE.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;

-- Ephemeral or replaceable rows the app legitimately deletes.
GRANT DELETE ON sessions, email_tokens, rate_limits, mfa_recovery_codes,
  availability_rules, availability_exceptions TO app_user;

-- Append-only for the app.
REVOKE UPDATE, DELETE ON audit_logs, clinical_notes, appointment_events FROM app_user;

-- Migration bookkeeping is off limits.
REVOKE ALL ON _prisma_migrations FROM app_user;

-- Future tables created by the migrator get the baseline automatically;
-- later migrations must still grant DELETE explicitly where needed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;
