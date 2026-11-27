-- Enables the four visit services and keeps their reminder job in one schedule.
DO $$
BEGIN
  IF to_regclass('private.v2_visit_feature_switches') IS NULL THEN
    RAISE EXCEPTION 'Apply the visit-services schema before enabling its features';
  END IF;
  IF to_regprocedure('public.v2_visit_reminder_tick()') IS NULL THEN
    RAISE EXCEPTION 'The visit reminder function is missing';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'Enable pg_cron before enabling automatic visit reminders';
  END IF;
END;
$$;

INSERT INTO private.v2_visit_feature_switches(feature, enabled)
VALUES ('support', true), ('queue', true), ('nearby', true), ('reminders', true)
ON CONFLICT (feature) DO UPDATE SET enabled = EXCLUDED.enabled;

DO $$
DECLARE existing_job_id bigint;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'patient-visit-reminders-v1';
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  PERFORM cron.schedule(
    'patient-visit-reminders-v1',
    '*/15 * * * *',
    'SELECT public.v2_visit_reminder_tick();'
  );
END;
$$;
