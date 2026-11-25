-- Applied to the production project and mirrored to staging.
-- Emergency conversations are kept for 30 days; rate-limit keys for 1 day.
CREATE INDEX IF NOT EXISTS emergency_chats_open_id_idx
  ON public.emergency_chats (id)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.create_emergency_chat_limited(
  p_visitor_name text,
  p_access_token_hash text,
  p_max_open integer DEFAULT 5000
)
RETURNS TABLE(id uuid, visitor_name text, status text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_open_count bigint;
BEGIN
  IF p_visitor_name IS NULL OR length(pg_catalog.btrim(p_visitor_name)) < 2
     OR length(p_visitor_name) > 80
     OR p_access_token_hash IS NULL OR length(p_access_token_hash) <> 64
     OR p_max_open < 1 OR p_max_open > 5000 THEN
    RAISE EXCEPTION 'invalid emergency chat request';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(894201, pg_catalog.hashtext('emergency_chat_open_cap'));
  SELECT pg_catalog.count(*) INTO v_open_count
  FROM public.emergency_chats AS ec WHERE ec.status = 'open';
  IF v_open_count >= p_max_open THEN RETURN; END IF;
  RETURN QUERY
  INSERT INTO public.emergency_chats (visitor_name, access_token_hash)
  VALUES (pg_catalog.btrim(p_visitor_name), p_access_token_hash)
  RETURNING emergency_chats.id, emergency_chats.visitor_name, emergency_chats.status, emergency_chats.created_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_emergency_chat_limited(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_emergency_chat_limited(text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_emergency_chat_records()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_deleted bigint := 0;
BEGIN
  DELETE FROM public.emergency_chats WHERE created_at < pg_catalog.now() - interval '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM private.emergency_chat_rate_limits WHERE updated_at < pg_catalog.now() - interval '1 day';
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.cleanup_emergency_chat_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_emergency_chat_records() TO service_role;

-- Schedule once daily at 02:17 UTC. Requires pg_cron, enabled on both projects.
DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'patient-emergency-chat-cleanup') THEN
    PERFORM cron.schedule('patient-emergency-chat-cleanup', '17 2 * * *', 'SELECT public.cleanup_emergency_chat_records();');
  END IF;
END;
$schedule$;

ALTER FUNCTION public.doctor_appointment_patient_details() SET search_path = '';
