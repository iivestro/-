-- PATIENT 2.0: metadata-only audit trail, no medical notes, contact details, or secrets.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.v2_audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid,
 entity text NOT NULL,
 entity_key text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
 before_state jsonb,
 after_state jsonb
);
ALTER TABLE private.v2_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.v2_audit_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE private.v2_audit_log_id_seq FROM PUBLIC, anon, authenticated;
CREATE INDEX v2_audit_entity_idx ON private.v2_audit_log(entity,entity_key,id DESC);
CREATE OR REPLACE FUNCTION private.v2_capture_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prev jsonb; nxt jsonb; old_state jsonb:='{}'; new_state jsonb:='{}'; k text; keys text[]; entity_key text;
BEGIN
 IF TG_TABLE_SCHEMA<>'public' THEN RAISE EXCEPTION 'Unexpected audit source'; END IF;
 CASE TG_TABLE_NAME
 WHEN 'profiles' THEN keys:=ARRAY['role','approval_status'];
 WHEN 'doctors' THEN keys:=ARRAY['is_active','admin_is_active','subscription_expires_at','subscription_fee'];
 WHEN 'medical_centers' THEN keys:=ARRAY['is_active','subscription_expires_at','subscription_fee'];
 WHEN 'rep_accounts' THEN keys:=ARRAY['status','subscription_expires_at','subscription_fee','subscription_is_trial'];
 WHEN 'home_service_providers' THEN keys:=ARRAY['approved','subscription_expires_at','subscription_fee','subscription_is_trial'];
 WHEN 'service_subscription_prices' THEN keys:=ARRAY['monthly_fee','duration_days'];
 WHEN 'appointments' THEN keys:=ARRAY['status'];
 WHEN 'center_appointments' THEN keys:=ARRAY['status'];
 WHEN 'rep_appointments' THEN keys:=ARRAY['status'];
 WHEN 'home_service_requests' THEN keys:=ARRAY['status'];
 ELSE RAISE EXCEPTION 'Unexpected audit entity';
 END CASE;
 IF TG_OP<>'INSERT' THEN prev:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN nxt:=to_jsonb(NEW); END IF;
 FOREACH k IN ARRAY keys LOOP
  IF prev ? k THEN old_state:=old_state||jsonb_build_object(k,prev->k); END IF;
  IF nxt ? k THEN new_state:=new_state||jsonb_build_object(k,nxt->k); END IF;
 END LOOP;
 IF TG_OP='UPDATE' AND old_state=new_state THEN RETURN NEW; END IF;
 entity_key:=coalesce(nxt->>'id',prev->>'id',nxt->>'profile_id',prev->>'profile_id',nxt->>'service',prev->>'service');
 IF entity_key IS NULL THEN RAISE EXCEPTION 'Audit entity key missing'; END IF;
 INSERT INTO private.v2_audit_log(actor_id,entity,entity_key,operation,before_state,after_state)
 VALUES(auth.uid(),TG_TABLE_NAME,entity_key,TG_OP,CASE WHEN TG_OP<>'INSERT' THEN old_state END,CASE WHEN TG_OP<>'DELETE' THEN new_state END);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_capture_audit() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','doctors','medical_centers','rep_accounts','home_service_providers','service_subscription_prices','appointments','center_appointments','rep_appointments','home_service_requests'] LOOP
 EXECUTE format('CREATE TRIGGER v2_audit_changes AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.v2_capture_audit()',t);
 END LOOP;
END $$;
-- The only read interface is a bounded, explicitly admin-authorized RPC.
CREATE OR REPLACE FUNCTION public.v2_admin_audit_page(p_before bigint DEFAULT NULL)
RETURNS TABLE(id bigint,occurred_at timestamptz,actor_id uuid,entity text,entity_key text,operation text,before_state jsonb,after_state jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.is_admin(),false) THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT a.id,a.occurred_at,a.actor_id,a.entity,a.entity_key,a.operation,a.before_state,a.after_state
 FROM private.v2_audit_log a WHERE p_before IS NULL OR a.id<p_before ORDER BY a.id DESC LIMIT 26;
END $$;
REVOKE ALL ON FUNCTION public.v2_admin_audit_page(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2_admin_audit_page(bigint) TO authenticated;
COMMIT;
