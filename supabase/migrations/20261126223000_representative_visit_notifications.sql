-- Notify representatives when a doctor confirms an entry time.
CREATE OR REPLACE FUNCTION private.notify_rep_visit_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_doctor_name text;
BEGIN
  IF NEW.status = 'approved'
     AND NEW.visit_at IS NOT NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.visit_at IS DISTINCT FROM NEW.visit_at) THEN
    SELECT p.full_name INTO v_doctor_name
    FROM public.doctors d
    JOIN public.profiles p ON p.id = d.profile_id
    WHERE d.id = NEW.doctor_id;

    INSERT INTO public.notifications(user_id, title, message)
    VALUES (
      NEW.rep_profile_id,
      'موعد زيارة المندوب',
      'وافق الطبيب ' || coalesce(nullif(pg_catalog.btrim(v_doctor_name), ''), 'المعالج') ||
      ' على زيارتك وحدد وقت الدخول بتاريخ ' ||
      pg_catalog.to_char(NEW.visit_at AT TIME ZONE 'Asia/Baghdad', 'DD-MM-YYYY') ||
      ' الساعة ' ||
      pg_catalog.to_char(NEW.visit_at AT TIME ZONE 'Asia/Baghdad', 'HH24:MI') ||
      '. افتح بوابة بلسم لمراجعة التفاصيل.'
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.notify_rep_visit_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rep_visit_approval_notification ON public.rep_appointments;
CREATE TRIGGER rep_visit_approval_notification
AFTER UPDATE OF status, visit_at ON public.rep_appointments
FOR EACH ROW EXECUTE FUNCTION private.notify_rep_visit_approval();

-- Allow the representative's own notification and booking changes to arrive live.
DO $publication$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'supabase_realtime publication is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rep_appointments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.rep_appointments';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END
$publication$;

-- Expose this new notification in the existing in-app notification list.
DO $notification_list$
DECLARE
  v_definition text;
  v_old text := 'title IN(''تذكير بموعدك'',''الدور الإلكتروني'',''حان دورك'',''رد الدعم الفني'')';
  v_new text := 'title IN(''تذكير بموعدك'',''الدور الإلكتروني'',''حان دورك'',''رد الدعم الفني'',''موعد زيارة المندوب'')';
BEGIN
  SELECT pg_get_functiondef('public.patient_visit_action(text,jsonb)'::regprocedure)
  INTO v_definition;
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not find the existing notification allow-list in patient_visit_action';
  END IF;
  EXECUTE replace(v_definition, v_old, v_new);
END
$notification_list$;
