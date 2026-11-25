-- Check the signed session claim against the Auth session row.
-- This supplements JWT signature verification, not a replacement for it.
CREATE OR REPLACE FUNCTION public.v2_session_active()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text:=auth.jwt()->>'session_id'; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR sid IS NULL OR sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=sid::uuid AND s.user_id=uid AND (s.not_after IS NULL OR s.not_after>now()));
END $$;
REVOKE ALL ON FUNCTION public.v2_session_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_session_active() TO authenticated;
