CREATE INDEX IF NOT EXISTS v2_reminder_ledger_recipient_idx
  ON private.v2_reminder_ledger (recipient);
CREATE INDEX IF NOT EXISTS v2_support_tickets_replied_by_idx
  ON private.v2_support_tickets (replied_by);
CREATE INDEX IF NOT EXISTS rep_subscription_payments_profile_id_idx
  ON public.rep_subscription_payments (profile_id);
CREATE INDEX IF NOT EXISTS rep_subscription_payments_recorded_by_idx
  ON public.rep_subscription_payments (recorded_by);

DROP POLICY IF EXISTS approved_patients_create_appointments ON public.appointments;
CREATE POLICY approved_patients_create_appointments
  ON public.appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    patient_id = (SELECT auth.uid())
    AND status = 'pending'
    AND (SELECT public.is_approved_user())
    AND (
      (
        appointment_at IS NULL
        AND requested_date IS NOT NULL
        AND requested_date >= (now() AT TIME ZONE 'Asia/Baghdad')::date
      )
      OR
      (
        appointment_at IS NOT NULL
        AND appointment_at > now()
        AND (requested_date IS NULL OR requested_date = (appointment_at AT TIME ZONE 'Asia/Baghdad')::date)
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.doctors d
      JOIN public.profiles p ON p.id = d.profile_id
      WHERE d.id = appointments.doctor_id
        AND d.is_active IS TRUE
        AND p.role = 'doctor'
        AND p.approval_status = 'approved'
    )
  );
