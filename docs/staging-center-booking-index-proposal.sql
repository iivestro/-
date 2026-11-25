-- Proposed STAGING migration; do not apply until overnight load is confirmed finished.
-- Confirm appointment_at semantics and check for duplicate active slots before applying.
SET lock_timeout = '2s';
CREATE UNIQUE INDEX uq_center_appointments_active_doctor_time
ON public.center_appointments (center_doctor_id, appointment_at)
WHERE appointment_at IS NOT NULL AND status IN ('pending', 'confirmed');
