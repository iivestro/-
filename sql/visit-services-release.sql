CREATE TABLE private.v2_support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 subject text NOT NULL CHECK(length(subject) BETWEEN 3 AND 120),
 body text NOT NULL CHECK(length(body) BETWEEN 3 AND 2000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','answered','closed')),
 reply text CHECK(length(reply)<=2000), replied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.v2_visit_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN('doctor','center')),
 booking_id uuid NOT NULL, patient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 provider_id uuid NOT NULL, service_date date NOT NULL, queue_number integer NOT NULL CHECK(queue_number>0),
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','called','completed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,booking_id,service_date), UNIQUE(kind,provider_id,service_date,queue_number)
);
CREATE TABLE private.v2_provider_geo (
 kind text NOT NULL CHECK(kind IN('doctor','center')), provider_id uuid NOT NULL,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(kind,provider_id)
);
CREATE INDEX v2_support_owner_idx ON private.v2_support_tickets(user_id,created_at DESC);
CREATE INDEX v2_support_admin_idx ON private.v2_support_tickets(status,created_at DESC);
CREATE INDEX v2_queue_owner_idx ON private.v2_visit_queue(patient_id,service_date DESC);
CREATE TABLE private.v2_visit_feature_switches(feature text PRIMARY KEY CHECK(feature IN('support','queue','nearby','reminders')),enabled boolean NOT NULL DEFAULT false);
INSERT INTO private.v2_visit_feature_switches(feature) VALUES('support'),('queue'),('nearby'),('reminders');
CREATE TABLE private.v2_reminder_ledger(kind text NOT NULL CHECK(kind IN('doctor','center')),target_id uuid NOT NULL,event_at timestamptz NOT NULL,recipient uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,target_id,event_at,recipient));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['v2_support_tickets','v2_visit_queue','v2_provider_geo','v2_visit_feature_switches','v2_reminder_ledger'] LOOP EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);END LOOP;END $$;
CREATE OR REPLACE FUNCTION public.patient_visit_action(p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); r text; result jsonb; q private.v2_visit_queue%ROWTYPE; k text;bid uuid;patient uuid;provider uuid;d date;next_num integer;nowday date:=(now() AT TIME ZONE 'Asia/Baghdad')::date;isadmin boolean;lat double precision;lon double precision;tid uuid;target uuid;state text;sid text:=auth.jwt()->>'session_id';f text;
BEGIN
 IF u IS NULL OR sid IS NULL OR sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Session required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s JOIN auth.users a ON a.id=s.user_id WHERE s.id=sid::uuid AND s.user_id=u AND (s.not_after IS NULL OR s.not_after>now()) AND (a.banned_until IS NULL OR a.banned_until<=now())) THEN RAISE EXCEPTION 'Session required' USING ERRCODE='42501';END IF;
 SELECT role INTO r FROM public.profiles WHERE id=u AND approval_status='approved';
 IF r IS NULL THEN RAISE EXCEPTION 'Approved account required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>8192 THEN RAISE EXCEPTION 'Invalid payload' USING ERRCODE='22023';END IF;
 f:=CASE WHEN p_action IN('support_list','support_create','support_reply') THEN 'support' WHEN p_action IN('queue_bookings','queue_checkin','queue_my','queue_provider','queue_update') THEN 'queue' WHEN p_action IN('nearby','geo_set','geo_providers') THEN 'nearby' WHEN p_action IN('visit_reminders','visit_notifications') THEN 'reminders' END;
 IF f IS NULL OR NOT EXISTS(SELECT 1 FROM private.v2_visit_feature_switches WHERE feature=f AND enabled) THEN RAISE EXCEPTION 'Feature disabled' USING ERRCODE='42501';END IF;
 isadmin:=r='admin';
 IF p_action='visit_notifications' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT title,message,created_at FROM public.notifications WHERE user_id=u AND title IN('تذكير بموعدك','الدور الإلكتروني','حان دورك','رد الدعم الفني') AND created_at>now()-interval '7 days' ORDER BY created_at DESC LIMIT 50)x;
 ELSIF p_action='visit_reminders' AND r='patient' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT b.id AS booking_id,'doctor'::text AS kind,b.appointment_at AS appointment_at,f.full_name AS provider_name
 FROM public.appointments b JOIN public.doctors d ON d.id=b.doctor_id JOIN public.profiles f ON f.id=d.profile_id
 WHERE b.patient_id=u AND b.status='approved' AND b.appointment_at>now() AND b.appointment_at<=now()+interval '24 hours' AND d.is_active AND d.admin_is_active AND d.subscription_expires_at>now() AND f.approval_status='approved'
 UNION ALL
 SELECT b.id,'center',b.appointment_at,cd.full_name FROM public.center_appointments b JOIN public.medical_centers c ON c.id=b.center_id JOIN public.center_doctors cd ON cd.id=b.center_doctor_id AND cd.center_id=c.id JOIN public.profiles f ON f.id=c.profile_id
 WHERE b.patient_id=u AND b.status='confirmed' AND b.appointment_at>now() AND b.appointment_at<=now()+interval '24 hours' AND c.is_active AND c.subscription_expires_at>now() AND cd.is_active AND f.approval_status='approved'
 ORDER BY appointment_at LIMIT 30)x;
 ELSIF p_action='support_list' THEN
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
 INSERT INTO public.notifications(user_id,title,message) SELECT user_id,'رد الدعم الفني','يوجد رد جديد على طلب الدعم. افتح قسم الدعم الفني.' FROM private.v2_support_tickets WHERE id=tid;
 result:=jsonb_build_object('id',tid);
 ELSIF p_action='queue_bookings' AND r IN('doctor','medical_center') THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT b.id,b.appointment_at,b.status,p.full_name AS patient_name FROM public.appointments b JOIN public.doctors d ON d.id=b.doctor_id JOIN public.profiles p ON p.id=b.patient_id WHERE r='doctor' AND d.profile_id=u AND d.is_active AND d.admin_is_active AND d.subscription_expires_at>now() AND b.status='approved' AND b.requested_date=nowday AND b.appointment_at IS NOT NULL
 UNION ALL SELECT b.id,b.appointment_at,b.status,p.full_name FROM public.center_appointments b JOIN public.medical_centers c ON c.id=b.center_id JOIN public.profiles p ON p.id=b.patient_id JOIN public.center_doctors cd ON cd.id=b.center_doctor_id AND cd.center_id=c.id WHERE r='medical_center' AND c.profile_id=u AND c.is_active AND c.subscription_expires_at>now() AND cd.is_active AND b.status='confirmed' AND b.requested_date=nowday AND b.appointment_at IS NOT NULL
 ORDER BY appointment_at LIMIT 100)x;
 ELSIF p_action='queue_checkin' AND r IN('doctor','medical_center') THEN
 k:=p_data->>'kind';bid:=(p_data->>'booking_id')::uuid;
 IF k='doctor' AND r='doctor' THEN
 SELECT b.patient_id,b.doctor_id,b.requested_date INTO patient,provider,d FROM public.appointments b JOIN public.doctors p ON p.id=b.doctor_id WHERE b.id=bid AND p.profile_id=u AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now() AND b.status='approved' AND b.requested_date=nowday FOR UPDATE OF b;
 ELSIF k='center' AND r='medical_center' THEN
 SELECT b.patient_id,b.center_doctor_id,b.requested_date INTO patient,provider,d FROM public.center_appointments b JOIN public.medical_centers p ON p.id=b.center_id JOIN public.center_doctors cd ON cd.id=b.center_doctor_id AND cd.center_id=p.id WHERE b.id=bid AND p.profile_id=u AND p.is_active AND p.subscription_expires_at>now() AND cd.is_active AND b.status='confirmed' AND b.requested_date=nowday FOR UPDATE OF b;
 END IF;
 IF patient IS NULL THEN RAISE EXCEPTION 'Booking unavailable' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(k||':'||provider::text||':'||d::text,0));
 SELECT * INTO q FROM private.v2_visit_queue WHERE kind=k AND booking_id=bid AND service_date=d;
 IF q.id IS NULL THEN
 SELECT coalesce(max(queue_number),0)+1 INTO next_num FROM private.v2_visit_queue WHERE kind=k AND provider_id=provider AND service_date=d;
 INSERT INTO private.v2_visit_queue(kind,booking_id,patient_id,provider_id,service_date,queue_number) VALUES(k,bid,patient,provider,d,next_num) RETURNING * INTO q;
 INSERT INTO public.notifications(user_id,title,message) VALUES(patient,'الدور الإلكتروني','تم تسجيل حضورك وإصدار رقم الدور.');
 END IF;
 result:=jsonb_build_object('id',q.id,'queue_number',q.queue_number,'state',q.state);
 ELSIF p_action='queue_my' AND r='patient' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT a.id,a.kind,a.booking_id,a.service_date,a.queue_number,a.state,(SELECT min(b.queue_number) FROM private.v2_visit_queue b WHERE b.kind=a.kind AND b.provider_id=a.provider_id AND b.service_date=a.service_date AND b.state='called') AS current_number,CASE a.kind WHEN 'doctor' THEN (SELECT f.full_name FROM public.doctors p JOIN public.profiles f ON f.id=p.profile_id WHERE p.id=a.provider_id) ELSE (SELECT cd.full_name FROM public.center_doctors cd WHERE cd.id=a.provider_id) END AS provider_name,
 CASE WHEN a.state IN('completed','cancelled') THEN 0 ELSE (SELECT count(*) FROM private.v2_visit_queue b WHERE b.kind=a.kind AND b.provider_id=a.provider_id AND b.service_date=a.service_date AND b.queue_number<a.queue_number AND b.state IN('waiting','called')) END AS ahead
 FROM private.v2_visit_queue a WHERE a.patient_id=u AND a.service_date>=nowday ORDER BY a.created_at DESC LIMIT 50)x;
 ELSIF p_action='queue_provider' AND r IN('doctor','medical_center') THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT a.id,a.booking_id,a.kind,a.queue_number,a.state,a.service_date,(SELECT p.full_name FROM public.profiles p WHERE p.id=a.patient_id) AS patient_name FROM private.v2_visit_queue a WHERE a.service_date=nowday AND (
 (r='doctor' AND a.kind='doctor' AND EXISTS(SELECT 1 FROM public.doctors p WHERE p.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now()))
 OR (r='medical_center' AND a.kind='center' AND EXISTS(SELECT 1 FROM public.center_doctors cd JOIN public.medical_centers p ON p.id=cd.center_id WHERE cd.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.subscription_expires_at>now() AND cd.is_active)))
 ORDER BY a.queue_number LIMIT 100)x;
 ELSIF p_action='queue_update' AND r IN('doctor','medical_center') THEN
 SELECT * INTO q FROM private.v2_visit_queue a WHERE a.id=(p_data->>'id')::uuid AND a.service_date=nowday AND (
 (r='doctor' AND a.kind='doctor' AND EXISTS(SELECT 1 FROM public.doctors p WHERE p.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now()))
 OR (r='medical_center' AND a.kind='center' AND EXISTS(SELECT 1 FROM public.center_doctors cd JOIN public.medical_centers p ON p.id=cd.center_id WHERE cd.id=a.provider_id AND p.profile_id=u AND p.is_active AND p.subscription_expires_at>now() AND cd.is_active))) FOR UPDATE;
 state:=p_data->>'state';
 IF q.id IS NULL OR NOT ((q.state='waiting' AND state IN('called','cancelled')) OR (q.state='called' AND state IN('completed','cancelled'))) THEN RAISE EXCEPTION 'Invalid queue transition' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(q.kind||':'||q.provider_id::text||':'||q.service_date::text,0));
 IF state='called' AND EXISTS(SELECT 1 FROM private.v2_visit_queue x WHERE x.kind=q.kind AND x.provider_id=q.provider_id AND x.service_date=q.service_date AND x.state='called' AND x.id<>q.id) THEN RAISE EXCEPTION 'Finish current visit first' USING ERRCODE='22023';END IF;
 UPDATE private.v2_visit_queue SET state=p_data->>'state' WHERE id=q.id;
 IF state='called' AND NOT ((q.kind='doctor' AND EXISTS(SELECT 1 FROM public.appointments b WHERE b.id=q.booking_id AND b.status='approved' AND b.requested_date=q.service_date)) OR(q.kind='center' AND EXISTS(SELECT 1 FROM public.center_appointments b WHERE b.id=q.booking_id AND b.status='confirmed' AND b.requested_date=q.service_date))) THEN RAISE EXCEPTION 'Booking no longer active' USING ERRCODE='42501'; END IF;
 IF state='called' THEN INSERT INTO public.notifications(user_id,title,message) VALUES(q.patient_id,'حان دورك','يرجى التوجه إلى الاستقبال.'); END IF;
 result:=jsonb_build_object('id',q.id,'state',state);
 ELSIF p_action='nearby' AND r='patient' THEN
 lat:=(p_data->>'latitude')::double precision;lon:=(p_data->>'longitude')::double precision;
 IF lat IS NULL OR lon IS NULL OR NOT(lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180) THEN RAISE EXCEPTION 'Invalid coordinates' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT g.kind,g.provider_id,CASE g.kind WHEN 'doctor' THEN (SELECT f.full_name FROM public.doctors p JOIN public.profiles f ON f.id=p.profile_id WHERE p.id=g.provider_id) WHEN 'center' THEN (SELECT p.name FROM public.medical_centers p WHERE p.id=g.provider_id) END AS provider_name,round((6371*acos(least(1.0,greatest(-1.0,sin(radians(lat))*sin(radians(g.latitude))+cos(radians(lat))*cos(radians(g.latitude))*cos(radians(g.longitude-lon))))))::numeric,1) AS distance_km
 FROM private.v2_provider_geo g WHERE abs(g.latitude-lat)<=2 AND abs(g.longitude-lon)<=3
 AND ((g.kind='doctor' AND EXISTS(SELECT 1 FROM public.doctors p JOIN public.profiles f ON f.id=p.profile_id WHERE p.id=g.provider_id AND p.is_active AND p.admin_is_active AND p.subscription_expires_at>now() AND f.approval_status='approved'))
 OR(g.kind='center' AND EXISTS(SELECT 1 FROM public.medical_centers p JOIN public.profiles f ON f.id=p.profile_id WHERE p.id=g.provider_id AND p.is_active AND p.subscription_expires_at>now() AND f.approval_status='approved'))
)
 ORDER BY distance_km LIMIT 50)x;
 ELSIF p_action='geo_set' AND isadmin THEN
 k:=p_data->>'kind';target:=(p_data->>'provider_id')::uuid;
 IF NOT ((k='doctor' AND EXISTS(SELECT 1 FROM public.doctors WHERE id=target)) OR(k='center' AND EXISTS(SELECT 1 FROM public.medical_centers WHERE id=target))) THEN RAISE EXCEPTION 'Invalid provider' USING ERRCODE='22023'; END IF;
 INSERT INTO private.v2_provider_geo(kind,provider_id,latitude,longitude) VALUES(k,target,(p_data->>'latitude')::double precision,(p_data->>'longitude')::double precision) ON CONFLICT(kind,provider_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
 result:=jsonb_build_object('saved',true);
 ELSIF p_action='geo_providers' AND isadmin THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT 'doctor'::text AS kind,d.id AS provider_id,p.full_name AS provider_name,g.latitude,g.longitude FROM public.doctors d JOIN public.profiles p ON p.id=d.profile_id LEFT JOIN private.v2_provider_geo g ON g.kind='doctor' AND g.provider_id=d.id
 UNION ALL SELECT 'center',c.id,c.name,g.latitude,g.longitude FROM public.medical_centers c LEFT JOIN private.v2_provider_geo g ON g.kind='center' AND g.provider_id=c.id
 ORDER BY provider_name LIMIT 200)x;
 ELSE RAISE EXCEPTION 'Forbidden action' USING ERRCODE='42501';
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.patient_visit_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_visit_action(text,jsonb) TO authenticated;
CREATE FUNCTION private.patient_sync_visit_queue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text:=CASE WHEN TG_TABLE_NAME='appointments' THEN 'doctor' ELSE 'center' END;
BEGIN
 IF TG_OP='DELETE' THEN UPDATE private.v2_visit_queue SET state='cancelled' WHERE kind=k AND booking_id=OLD.id AND state IN('waiting','called');RETURN OLD;END IF;
 UPDATE private.v2_visit_queue SET state=CASE WHEN NEW.status='completed' AND service_date=NEW.requested_date THEN 'completed' ELSE 'cancelled' END
 WHERE kind=k AND booking_id=NEW.id AND state IN('waiting','called') AND (service_date IS DISTINCT FROM NEW.requested_date OR NEW.status NOT IN('approved','confirmed'));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.patient_sync_visit_queue() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER patient_sync_doctor_queue AFTER UPDATE OF status,requested_date OR DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.patient_sync_visit_queue();
CREATE TRIGGER patient_sync_center_queue AFTER UPDATE OF status,requested_date OR DELETE ON public.center_appointments FOR EACH ROW EXECUTE FUNCTION private.patient_sync_visit_queue();
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
