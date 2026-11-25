-- Push dispatch lifecycle: ticket != delivery. Expired sessions never eligible.
ALTER TABLE private.v2_push_devices ADD COLUMN session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE;
DELETE FROM private.v2_push_devices WHERE session_id IS NULL;
ALTER TABLE private.v2_push_devices ALTER COLUMN session_id SET NOT NULL;
CREATE OR REPLACE FUNCTION private.v2_bind_push_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.v2_session_active() OR auth.uid() IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'Session required' USING ERRCODE='42501';END IF;
 NEW.session_id:=(auth.jwt()->>'session_id')::uuid;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_bind_push_session() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v2_push_session_bind BEFORE INSERT ON private.v2_push_devices FOR EACH ROW EXECUTE FUNCTION private.v2_bind_push_session();
ALTER TABLE private.v2_push_outbox ADD COLUMN claimed_at timestamptz, ADD COLUMN ticket_id text, ADD COLUMN receipt_checked_at timestamptz, ADD COLUMN delivery_result text;
CREATE OR REPLACE FUNCTION public.v2_push_claim()
RETURNS TABLE(id bigint,expo_token text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE enabled) THEN RETURN;END IF;
 UPDATE private.v2_push_outbox SET state='failed',delivery_result='uncertain_timeout' WHERE state='sending' AND claimed_at<now()-interval '10 minutes';
 RETURN QUERY WITH picked AS (SELECT o.id FROM private.v2_push_outbox o JOIN private.v2_push_devices d ON d.id=o.device_id JOIN auth.sessions s ON s.id=d.session_id JOIN public.profiles p ON p.id=d.user_id AND p.approval_status='approved' WHERE o.state='pending' AND (s.not_after IS NULL OR s.not_after>now()) AND o.created_at>now()-interval '24 hours' ORDER BY o.id LIMIT 50 FOR UPDATE OF o SKIP LOCKED)
 UPDATE private.v2_push_outbox o SET state='sending',claimed_at=now() FROM picked,private.v2_push_devices d WHERE o.id=picked.id AND d.id=o.device_id RETURNING o.id,d.expo_token;
END $$;
CREATE OR REPLACE FUNCTION public.v2_push_ticket(p_id bigint,p_ticket text,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE device uuid;
BEGIN
 IF p_ticket IS NOT NULL AND (length(p_ticket)>100 OR length(p_ticket)<1) THEN RAISE EXCEPTION 'Invalid ticket';END IF;
 UPDATE private.v2_push_outbox SET state=CASE WHEN p_ticket IS NULL THEN 'failed' ELSE 'sent' END,ticket_id=p_ticket,delivery_result=CASE WHEN p_ticket IS NULL THEN coalesce(p_error,'send_failed') ELSE 'awaiting_receipt' END WHERE id=p_id AND state='sending' RETURNING device_id INTO device;
 IF p_error='DeviceNotRegistered' AND device IS NOT NULL THEN DELETE FROM private.v2_push_devices WHERE id=device;END IF;
 IF p_ticket IS NULL AND device IS NOT NULL THEN PERFORM public.v2_record_operational_event('push','notification_failed');END IF;
END $$;
CREATE OR REPLACE FUNCTION public.v2_push_receipts()
RETURNS TABLE(id bigint,ticket_id text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT o.id,o.ticket_id FROM private.v2_push_outbox o WHERE o.state='sent' AND o.delivery_result='awaiting_receipt' AND o.claimed_at<=now()-interval '15 minutes' AND (o.receipt_checked_at IS NULL OR o.receipt_checked_at<now()-interval '15 minutes') AND EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE enabled) ORDER BY o.id LIMIT 50
$$;
CREATE OR REPLACE FUNCTION public.v2_push_receipt_result(p_id bigint,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE device uuid;
BEGIN
 IF p_status NOT IN('provider_accepted','DeviceNotRegistered','receipt_failed','awaiting_receipt') THEN RAISE EXCEPTION 'Invalid receipt';END IF;
 UPDATE private.v2_push_outbox SET receipt_checked_at=now(),delivery_result=CASE WHEN p_status='awaiting_receipt' AND claimed_at<now()-interval '24 hours' THEN 'receipt_expired' ELSE p_status END WHERE id=p_id AND state='sent' AND delivery_result='awaiting_receipt' RETURNING device_id INTO device;
 IF p_status='DeviceNotRegistered' AND device IS NOT NULL THEN DELETE FROM private.v2_push_devices WHERE id=device;END IF;
 IF p_status='receipt_failed' AND device IS NOT NULL THEN PERFORM public.v2_record_operational_event('push','notification_failed');END IF;
END $$;
REVOKE ALL ON FUNCTION public.v2_push_claim(),public.v2_push_ticket(bigint,text,text),public.v2_push_receipts(),public.v2_push_receipt_result(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_push_claim(),public.v2_push_ticket(bigint,text,text),public.v2_push_receipts(),public.v2_push_receipt_result(bigint,text) TO service_role;
