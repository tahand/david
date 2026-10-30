-- Permanent erasure for the retention job (SPEC §6.2: soft-delete only; a
-- retention job handles permanent erasure).
--
-- app_user cannot DELETE patients, appointments or the append-only tables, and
-- that stays true. Instead this SECURITY DEFINER function, owned by the schema
-- owner, erases one patient, and only when the retention rule is met. The
-- rule is checked here, in the database, so the app can't erase a record
-- early even if it is compromised:
--   * the patient was soft-deleted more than p_retention_years ago, and
--   * none of their appointments ended within that period.
-- audit_logs are kept; they hold IDs only, never personal data.

CREATE FUNCTION erase_patient(p_patient_id uuid, p_retention_years integer)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz;
  v_user_id uuid;
  v_deleted integer;
BEGIN
  IF p_retention_years IS NULL OR p_retention_years < 1 THEN
    RAISE EXCEPTION 'retention period must be at least one year';
  END IF;
  v_cutoff := now() - make_interval(years => p_retention_years);

  SELECT user_id INTO v_user_id
  FROM patients
  WHERE id = p_patient_id AND deleted_at IS NOT NULL AND deleted_at < v_cutoff
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM appointments WHERE patient_id = p_patient_id AND ends_at >= v_cutoff) THEN
    RETURN false;
  END IF;

  -- clinical_notes is append-only against UPDATE, so the amends_note_id
  -- SET NULL action must never fire: delete notes nothing else amends, until none remain.
  LOOP
    DELETE FROM clinical_notes n
    WHERE n.patient_id = p_patient_id
      AND NOT EXISTS (SELECT 1 FROM clinical_notes a WHERE a.amends_note_id = n.id);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    EXIT WHEN v_deleted = 0;
  END LOOP;

  DELETE FROM appointment_events
  WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_id = p_patient_id);
  DELETE FROM appointments WHERE patient_id = p_patient_id;
  DELETE FROM patients WHERE id = p_patient_id;

  -- The patient's login, if any (sessions, tokens and recovery codes cascade).
  -- Staff accounts are never removed here.
  IF v_user_id IS NOT NULL THEN
    DELETE FROM users WHERE id = v_user_id AND role = 'patient';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION erase_patient(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_patient(uuid, integer) TO app_user;
