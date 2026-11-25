-- Staging only. No charge or payment processor; ledger records administrative renewal.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.v2_renewal_ledger(
 request_id uuid PRIMARY KEY,
 actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('doctor','medical_center','representative')),
 target_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.v2_renewal_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.v2_renewal_ledger FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.v2_renew_subscription(p_request_id uuid,p_kind text,p_target_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); previous private.v2_renewal_ledger%rowtype; expiry timestamptz;
BEGIN
 IF actor IS NULL OR NOT coalesce(public.is_admin(),false) THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_target_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('doctor','medical_center','representative') THEN RAISE EXCEPTION 'Invalid renewal' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('v2_renewal:'||p_request_id::text,0));
 SELECT * INTO previous FROM private.v2_renewal_ledger WHERE request_id=p_request_id;
 IF FOUND THEN
  IF previous.actor_id IS DISTINCT FROM actor OR previous.kind IS DISTINCT FROM p_kind OR previous.target_id IS DISTINCT FROM p_target_id THEN RAISE EXCEPTION 'Request identifier already used' USING ERRCODE='23505'; END IF;
  RETURN previous.expires_at;
 END IF;
 IF p_kind='representative' THEN expiry:=public.admin_renew_representative_subscription(p_target_id);
 ELSE expiry:=public.admin_renew_clinical_subscription(p_kind,p_target_id); END IF;
 INSERT INTO private.v2_renewal_ledger(request_id,actor_id,kind,target_id,expires_at) VALUES(p_request_id,actor,p_kind,p_target_id,expiry);
 RETURN expiry;
END $$;
REVOKE ALL ON FUNCTION public.v2_renew_subscription(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_renew_subscription(uuid,text,uuid) TO authenticated;
COMMIT;
