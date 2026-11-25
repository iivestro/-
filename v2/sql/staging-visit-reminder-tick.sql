-- Scheduled notification preparation; stays disabled until the reminders switch is enabled.
CREATE OR REPLACE FUNCTION public.v2_visit_reminder_tick()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inserted_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.v2_visit_feature_switches WHERE feature='reminders' AND enabled) THEN RETURN 0; END IF;
 WITH due AS (
 SELECT 'doctor'::text AS kind,b.id AS target_id,b.appointment_at AS event_at,b.patient_id AS recipient FROM public.appointments b JOIN public.doctors d ON d.id=b.doctor_id JOIN public.profiles f ON f.id=d.profile_id WHERE b.status='approved' AND d.is_active AND d.admin_is_active AND d.subscription_expires_at>now() AND f.approval_status='approved' AND b.appointment_at>now() AND b.appointment_at<=now()+interval '24 hours'
 UNION ALL
 SELECT 'center',b.id,b.appointment_at,b.patient_id FROM public.center_appointments b JOIN public.medical_centers c ON c.id=b.center_id JOIN public.center_doctors cd ON cd.id=b.center_doctor_id AND cd.center_id=c.id JOIN public.profiles f ON f.id=c.profile_id WHERE b.status='confirmed' AND c.is_active AND c.subscription_expires_at>now() AND cd.is_active AND f.approval_status='approved' AND b.appointment_at>now() AND b.appointment_at<=now()+interval '24 hours'
 ), fresh AS (
 INSERT INTO private.v2_reminder_ledger(kind,target_id,event_at,recipient)
 SELECT a.kind,a.target_id,a.event_at,a.recipient FROM due a JOIN public.profiles p ON p.id=a.recipient AND p.approval_status='approved'
 WHERE NOT EXISTS(SELECT 1 FROM private.v2_reminder_ledger l WHERE l.kind=a.kind AND l.target_id=a.target_id AND l.event_at=a.event_at AND l.recipient=a.recipient)
 ORDER BY a.event_at LIMIT 500 ON CONFLICT DO NOTHING RETURNING recipient)
 INSERT INTO public.notifications(user_id,title,message)
 SELECT recipient,'تذكير بموعدك','لديك موعد خلال 24 ساعة، افتح بيشنت لمراجعة التفاصيل.' FROM fresh;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION public.v2_visit_reminder_tick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_visit_reminder_tick() TO service_role;