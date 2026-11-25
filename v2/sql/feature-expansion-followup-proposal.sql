CREATE OR REPLACE FUNCTION public.v2_feature_action(p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); r text; result jsonb; q private.v2_visit_queue%ROWTYPE;
 k text; bid uuid; patient uuid; provider uuid; d date; next_num integer; st text; nowday date:=(now() AT TIME ZONE 'Asia/Baghdad')::date;
 isadmin boolean; lat double precision; lon double precision; tid uuid; target uuid; state text; a text;
BEGIN
 IF u IS NULL OR NOT public.v2_session_active() THEN RAISE EXCEPTION 'Session required' USING ERRCODE='42501'; END IF;
 SELECT role INTO r FROM public.profiles WHERE id=u AND approval_status='approved';
 IF r IS NULL THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>8192 THEN RAISE EXCEPTION 'Invalid payload' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE singleton AND enabled) THEN RAISE EXCEPTION 'Feature disabled' USING ERRCODE='42501'; END IF;
 isadmin:=r='admin';
 IF p_action='support_list' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT id,subject,body,status,reply,created_at,updated_at FROM private.v2_support_tickets
 WHERE isadmin OR user_id=u ORDER BY created_at DESC LIMIT 50)x;
 ELSIF p_action='support_create' THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('support:'||u::text,0));
 IF EXISTS(SELECT 1 FROM private.v2_support_tickets WHERE user_id=u AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Try later' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM private.v2_support_tickets WHERE user_id=u AND status='open')>=5 THEN RAISE EXCEPTION 'Too many open tickets' USING ERRCODE='22023'; END IF;
 INSERT INTO private.v2_support_tickets(user_id,subject,body) VALUES(u,trim(p_data->>'subject'),trim(p_data->>'body')) RETURNING id INTO tid;
 result:=jsonb_build_object('id',tid);
 ELSIF p_action='support_reply' AND isadmin THEN
 UPDATE private.v2_support_tickets SET reply=trim(p_data->>'reply'),replied_by=u,status='answered',updated_at=now() WHERE id=(p_data->>'id')::uuid AND status='open' RETURNING id INTO tid;
 IF tid IS NULL OR nullif(trim(p_data->>'reply'),'') IS NULL THEN RAISE EXCEPTION 'Invalid ticket' USING ERRCODE='22023'; END IF;
 result:=jsonb_build_object('id',tid);
 ELSIF p_action='health_list' AND r='patient' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT id,category,title,note,record_date,created_at FROM private.v2_personal_health_items WHERE patient_id=u ORDER BY created_at DESC LIMIT 50)x;
 ELSIF p_action='health_add' AND r='patient' THEN
 PERFORM pg_advisory_xact_lock(hashtextextended('health:'||u::text,0));
 IF (SELECT count(*) FROM private.v2_personal_health_items WHERE patient_id=u)>=200 THEN RAISE EXCEPTION 'Limit reached' USING ERRCODE='22023'; END IF;
 INSERT INTO private.v2_personal_health_items(patient_id,category,title,note,record_date) VALUES(u,p_data->>'category',trim(p_data->>'title'),coalesce(p_data->>'note',''),coalesce((p_data->>'record_date')::date,nowday)) RETURNING id INTO tid;
 result:=jsonb_build_object('id',tid);
 ELSIF p_action='health_delete' AND r='patient' THEN
 DELETE FROM private.v2_personal_health_items WHERE patient_id=u AND id=(p_data->>'id')::uuid RETURNING id INTO tid;
 result:=jsonb_build_object('deleted',tid IS NOT NULL);
 ELSIF p_action='queue_checkin' AND r IN('doctor','medical_center') THEN
 k:=p_data->>'kind';bid:=(p_data->>'booking_id')::uuid;
 IF k='doctor' AND r='doctor' THEN
 SELECT b.patient_id,b.doctor_id,b.requested_date INTO patient,provider,d FROM public.appointments b JOIN public.doctors p ON p.id=b.doctor_id WHERE b.id=bid AND p.profile_id=u AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now() AND b.status='approved' AND b.requested_date=nowday FOR UPDATE OF b;
 ELSIF k='center' AND r='medical_center' THEN
 SELECT b.patient_id,b.center_doctor_id,b.requested_date INTO patient,provider,d FROM public.center_appointments b JOIN public.medical_centers p ON p.id=b.center_id JOIN public.center_doctors cd ON cd.id=b.center_doctor_id AND cd.center_id=p.id WHERE b.id=bid AND p.profile_id=u AND p.is_active AND p.subscription_expires_at>now() AND cd.is_active AND b.status='confirmed' AND b.requested_date=nowday FOR UPDATE OF b;
 END IF;
 IF patient IS NULL THEN RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(k||':'||provider::text||':'||d::text,0));
 SELECT * INTO q FROM private.v2_visit_queue WHERE kind=k AND booking_id=bid;
 IF q.id IS NULL THEN
 SELECT coalesce(max(queue_number),0)+1 INTO next_num FROM private.v2_visit_queue WHERE kind=k AND provider_id=provider AND service_date=d;
 INSERT INTO private.v2_visit_queue(kind,booking_id,patient_id,provider_id,service_date,queue_number) VALUES(k,bid,patient,provider,d,next_num) RETURNING * INTO q;
 INSERT INTO public.notifications(user_id,title,message) VALUES(patient,'الدور الإلكتروني','تم تسجيل حضورك وإصدار رقم الدور.');
 END IF;
 result:=jsonb_build_object('id',q.id,'queue_number',q.queue_number,'state',q.state);
 ELSIF p_action='queue_my' AND r='patient' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT a.id,a.kind,a.booking_id,a.service_date,a.queue_number,a.state,
 CASE WHEN a.state IN('completed','cancelled') THEN 0 ELSE (SELECT count(*) FROM private.v2_visit_queue b WHERE b.kind=a.kind AND b.provider_id=a.provider_id AND b.service_date=a.service_date AND b.queue_number<a.queue_number AND b.state IN('waiting','called')) END AS ahead
 FROM private.v2_visit_queue a WHERE a.patient_id=u AND a.service_date>=nowday ORDER BY a.created_at DESC LIMIT 50)x;
 ELSIF p_action='queue_provider' AND r IN('doctor','medical_center') THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT a.id,a.booking_id,a.kind,a.queue_number,a.state,a.service_date FROM private.v2_visit_queue a WHERE a.service_date=nowday AND (
 (r='doctor' AND a.kind='doctor' AND EXISTS(SELECT 1 FROM public.doctors p WHERE p.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now()))
 OR (r='medical_center' AND a.kind='center' AND EXISTS(SELECT 1 FROM public.center_doctors cd JOIN public.medical_centers p ON p.id=cd.center_id WHERE cd.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.subscription_expires_at>now() AND cd.is_active)))
 ORDER BY a.queue_number LIMIT 100)x;
 ELSIF p_action='queue_update' AND r IN('doctor','medical_center') THEN
 SELECT * INTO q FROM private.v2_visit_queue a WHERE a.id=(p_data->>'id')::uuid AND a.service_date=nowday AND (
 (r='doctor' AND a.kind='doctor' AND EXISTS(SELECT 1 FROM public.doctors p WHERE p.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now()))
 OR (r='medical_center' AND a.kind='center' AND EXISTS(SELECT 1 FROM public.center_doctors cd JOIN public.medical_centers p ON p.id=cd.center_id WHERE cd.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.subscription_expires_at>now() AND cd.is_active))) FOR UPDATE;
 state:=p_data->>'state';
 IF q.id IS NULL OR NOT ((q.state='waiting' AND state IN('called','cancelled')) OR (q.state='called' AND state IN('completed','cancelled'))) THEN RAISE EXCEPTION 'Invalid queue transition' USING ERRCODE='42501'; END IF;
 UPDATE private.v2_visit_queue SET state=p_data->>'state' WHERE id=q.id;
 IF state='called' AND NOT ((q.kind='doctor' AND EXISTS(SELECT 1 FROM public.appointments b WHERE b.id=q.booking_id AND b.status='approved' AND b.requested_date=q.service_date)) OR(q.kind='center' AND EXISTS(SELECT 1 FROM public.center_appointments b WHERE b.id=q.booking_id AND b.status='confirmed' AND b.requested_date=q.service_date))) THEN RAISE EXCEPTION 'Booking no longer active' USING ERRCODE='42501'; END IF;
 IF state='called' THEN INSERT INTO public.notifications(user_id,title,message) VALUES(q.patient_id,'حان دورك','يرجى التوجه إلى الاستقبال.'); END IF;
 result:=jsonb_build_object('id',q.id,'state',state);
 ELSIF p_action='push_register' THEN
 IF p_data->>'consent' IS DISTINCT FROM 'true' OR coalesce(p_data->>'token','') !~ '^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$' THEN RAISE EXCEPTION 'Invalid token or consent' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('push:'||u::text,0));
 IF (SELECT count(*) FROM private.v2_push_devices WHERE user_id=u)>=10 THEN RAISE EXCEPTION 'Device limit' USING ERRCODE='22023'; END IF;
 INSERT INTO private.v2_push_devices(user_id,expo_token,platform) VALUES(u,p_data->>'token',p_data->>'platform') ON CONFLICT(expo_token) DO NOTHING;
 result:=jsonb_build_object('registered',EXISTS(SELECT 1 FROM private.v2_push_devices WHERE user_id=u AND expo_token=p_data->>'token'));
 ELSIF p_action='push_remove' THEN
 DELETE FROM private.v2_push_devices WHERE user_id=u AND expo_token=p_data->>'token';
 result:=jsonb_build_object('removed',true);
 ELSIF p_action='nearby' AND r='patient' THEN
 lat:=(p_data->>'latitude')::double precision;lon:=(p_data->>'longitude')::double precision;
 IF lat IS NULL OR lon IS NULL OR NOT(lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180) THEN RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT g.kind,g.provider_id,CASE g.kind WHEN 'doctor' THEN (SELECT f.full_name FROM public.doctors p JOIN public.profiles f ON f.id=p.profile_id WHERE p.id=g.provider_id) WHEN 'center' THEN (SELECT p.name FROM public.medical_centers p WHERE p.id=g.provider_id) WHEN 'home' THEN (SELECT p.display_name FROM public.home_service_providers p WHERE p.id=g.provider_id) END AS provider_name,round((6371*acos(least(1.0,greatest(-1.0,sin(radians(lat))*sin(radians(g.latitude))+cos(radians(lat))*cos(radians(g.latitude))*cos(radians(g.longitude-lon))))))::numeric,1) AS distance_km
 FROM private.v2_provider_geo g WHERE abs(g.latitude-lat)<=2 AND abs(g.longitude-lon)<=3
 AND ((g.kind='doctor' AND EXISTS(SELECT 1 FROM public.doctors p JOIN public.profiles f ON f.id=p.profile_id WHERE p.id=g.provider_id AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now() AND f.approval_status='approved'))
 OR(g.kind='center' AND EXISTS(SELECT 1 FROM public.medical_centers p JOIN public.profiles f ON f.id=p.profile_id WHERE p.id=g.provider_id AND p.is_active AND p.subscription_expires_at>now() AND f.approval_status='approved'))
 OR(g.kind='home' AND EXISTS(SELECT 1 FROM public.home_service_providers p WHERE p.id=g.provider_id AND p.approved AND p.subscription_expires_at>now())))
 ORDER BY distance_km LIMIT 50)x;
 ELSIF p_action='geo_set' AND isadmin THEN
 k:=p_data->>'kind';target:=(p_data->>'provider_id')::uuid;
 IF NOT ((k='doctor' AND EXISTS(SELECT 1 FROM public.doctors WHERE id=target)) OR(k='center' AND EXISTS(SELECT 1 FROM public.medical_centers WHERE id=target)) OR(k='home' AND EXISTS(SELECT 1 FROM public.home_service_providers WHERE id=target))) THEN RAISE EXCEPTION 'Invalid provider' USING ERRCODE='22023'; END IF;
 INSERT INTO private.v2_provider_geo(kind,provider_id,latitude,longitude) VALUES(k,target,(p_data->>'latitude')::double precision,(p_data->>'longitude')::double precision) ON CONFLICT(kind,provider_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
 result:=jsonb_build_object('saved',true);
 ELSIF p_action='announcements' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT id,kind,title,body,starts_at,ends_at FROM private.v2_public_announcements WHERE published AND starts_at<=now() AND ends_at>now() ORDER BY created_at DESC LIMIT 20)x;
 ELSIF p_action='announcement_create' AND isadmin THEN
 INSERT INTO private.v2_public_announcements(kind,title,body,ends_at,published,created_by) VALUES(p_data->>'kind',trim(p_data->>'title'),trim(p_data->>'body'),(p_data->>'ends_at')::timestamptz,false,u) RETURNING id INTO tid;
 result:=jsonb_build_object('id',tid,'published',false);
 ELSIF p_action='announcement_admin_list' AND isadmin THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT id,kind,title,body,starts_at,ends_at,published FROM private.v2_public_announcements ORDER BY created_at DESC LIMIT 50)x;
 ELSIF p_action='announcement_publish' AND isadmin THEN
 UPDATE private.v2_public_announcements SET published=(p_data->>'published')::boolean WHERE id=(p_data->>'id')::uuid AND ends_at>now() RETURNING id INTO tid;
 result:=jsonb_build_object('updated',tid IS NOT NULL);
 ELSIF p_action='maintenance_status' THEN
 SELECT jsonb_build_object('maintenance',maintenance,'message',maintenance_message) INTO result FROM private.v2_feature_settings WHERE singleton;
 ELSIF p_action='maintenance_set' AND isadmin THEN
 IF length(coalesce(p_data->>'message',''))>300 THEN RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023'; END IF;
 UPDATE private.v2_feature_settings SET maintenance=(p_data->>'enabled')::boolean,maintenance_message=coalesce(p_data->>'message',''),updated_at=now() WHERE singleton;
 result:=jsonb_build_object('saved',true,'enforced',false);
 ELSIF p_action='regions' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT governorate,district,active FROM private.v2_region_directory WHERE active OR isadmin ORDER BY governorate,district LIMIT 200)x;
 ELSIF p_action='region_set' AND isadmin THEN
 INSERT INTO private.v2_region_directory(governorate,district,active) VALUES(trim(p_data->>'governorate'),trim(p_data->>'district'),coalesce((p_data->>'active')::boolean,true)) ON CONFLICT(governorate,district) DO UPDATE SET active=excluded.active;
 result:=jsonb_build_object('saved',true);
 ELSIF p_action='staff_list' AND isadmin THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT user_id,permission,active FROM private.v2_admin_staff_assignments ORDER BY created_at DESC LIMIT 100)x;
 ELSIF p_action='staff_draft' AND isadmin THEN
 target:=(p_data->>'user_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=target AND approval_status='approved') THEN RAISE EXCEPTION 'Invalid user' USING ERRCODE='22023'; END IF;
 INSERT INTO private.v2_admin_staff_assignments(user_id,permission,active) VALUES(target,p_data->>'permission',false) ON CONFLICT(user_id,permission) DO NOTHING;
 result:=jsonb_build_object('saved',true,'active',false);
 ELSIF p_action='payment_record' AND isadmin THEN
 IF (p_data->>'paid_at')::timestamptz>now() THEN RAISE EXCEPTION 'Future payment' USING ERRCODE='22023'; END IF;
 INSERT INTO private.v2_payment_records(request_id,service,amount_iqd,paid_at,reference,recorded_by) VALUES((p_data->>'request_id')::uuid,p_data->>'service',(p_data->>'amount_iqd')::integer,(p_data->>'paid_at')::timestamptz,trim(p_data->>'reference'),u) ON CONFLICT(request_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM private.v2_payment_records x WHERE x.request_id=(p_data->>'request_id')::uuid AND x.recorded_by=u AND x.service=p_data->>'service' AND x.amount_iqd=(p_data->>'amount_iqd')::integer AND x.paid_at=(p_data->>'paid_at')::timestamptz AND x.reference=trim(p_data->>'reference')) THEN RAISE EXCEPTION 'Payment request mismatch' USING ERRCODE='22023'; END IF;
 result:=jsonb_build_object('saved',true);
 ELSIF p_action='admin_summary' AND isadmin THEN
 result:=jsonb_build_object('recorded_revenue_iqd',(SELECT coalesce(sum(amount_iqd),0) FROM private.v2_payment_records WHERE paid_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Baghdad') AT TIME ZONE 'Asia/Baghdad'),
 'payment_count',(SELECT count(*) FROM private.v2_payment_records WHERE paid_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Baghdad') AT TIME ZONE 'Asia/Baghdad'),
 'support_open',(SELECT count(*) FROM private.v2_support_tickets WHERE status='open'),
 'subscriptions_expiring',(SELECT count(*) FROM (SELECT subscription_expires_at FROM public.doctors UNION ALL SELECT subscription_expires_at FROM public.medical_centers UNION ALL SELECT subscription_expires_at FROM public.rep_accounts UNION ALL SELECT subscription_expires_at FROM public.home_service_providers) s WHERE s.subscription_expires_at BETWEEN now() AND now()+interval '7 days'),
 'errors_24h',(SELECT count(*) FROM private.v2_operational_events WHERE occurred_at>now()-interval '24 hours'),
 'maintenance',(SELECT maintenance FROM private.v2_feature_settings WHERE singleton));
 ELSE RAISE EXCEPTION 'Forbidden action' USING ERRCODE='42501';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.v2_feature_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_feature_action(text,jsonb) TO authenticated;

-- Close stale queue rows automatically when existing appointment workflow changes.
CREATE OR REPLACE FUNCTION private.v2_sync_queue_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text:=CASE WHEN TG_TABLE_NAME='appointments' THEN 'doctor' ELSE 'center' END;
BEGIN
 IF NEW.status IN('cancelled','rejected') OR NEW.requested_date IS DISTINCT FROM OLD.requested_date THEN
 UPDATE private.v2_visit_queue SET state='cancelled' WHERE kind=k AND booking_id=NEW.id AND state IN('waiting','called');
 ELSIF NEW.status='completed' THEN
 UPDATE private.v2_visit_queue SET state='completed' WHERE kind=k AND booking_id=NEW.id AND state IN('waiting','called');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_sync_queue_booking() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v2_sync_doctor_queue AFTER UPDATE OF status,requested_date ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.v2_sync_queue_booking();
CREATE TRIGGER v2_sync_center_queue AFTER UPDATE OF status,requested_date ON public.center_appointments FOR EACH ROW EXECUTE FUNCTION private.v2_sync_queue_booking();
CREATE OR REPLACE FUNCTION public.v2_record_operational_event(p_component text,p_event_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE singleton AND enabled) THEN
 INSERT INTO private.v2_operational_events(component,event_type) VALUES(p_component,p_event_type);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.v2_record_operational_event(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_record_operational_event(text,text) TO service_role;
