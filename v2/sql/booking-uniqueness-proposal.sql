-- PROPOSAL ONLY: not automatically applied.
-- Read-only staging preflight 2026-11-25 found zero duplicate groups for all three keys.
-- Rerun duplicate checks immediately before migration; confirm no active load.
-- Design: at most one active request per patient/provider/effective Baghdad date.
-- This is a proposed business rule; verify against legacy workflows.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE UNIQUE INDEX uq_v2_doctor_patient_day_active
ON public.appointments (patient_id, doctor_id, (coalesce((appointment_at AT TIME ZONE 'Asia/Baghdad')::date, requested_date)))
WHERE status IN ('pending','approved');
CREATE UNIQUE INDEX uq_v2_center_patient_day_active
ON public.center_appointments (patient_id, center_doctor_id, (coalesce((appointment_at AT TIME ZONE 'Asia/Baghdad')::date, requested_date)))
WHERE status IN ('pending','confirmed');
CREATE UNIQUE INDEX uq_v2_center_doctor_time_active
ON public.center_appointments (center_doctor_id, appointment_at)
WHERE appointment_at IS NOT NULL AND status IN ('pending','confirmed');
COMMIT;
-- Rollback after verifying application compatibility:
-- DROP INDEX public.uq_v2_doctor_patient_day_active;
-- DROP INDEX public.uq_v2_center_patient_day_active;
-- DROP INDEX public.uq_v2_center_doctor_time_active;
-- These indexes alone do not enforce daily capacity or subscription eligibility.
