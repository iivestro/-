-- Notification preparation only: no network calls, scheduled jobs or actual delivery.
CREATE TABLE private.v2_push_outbox(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES private.v2_push_devices(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','sent','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(notification_id,device_id)
);
CREATE INDEX v2_push_pending_idx ON private.v2_push_outbox(state,created_at);
CREATE TABLE private.v2_reminder_ledger(
 kind text NOT NULL CHECK(kind IN('doctor','center','doctor_subscription','center_subscription','representative_subscription','home_subscription')),
 target_id uuid NOT NULL, event_at timestamptz NOT NULL,
 recipient uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,target_id,event_at,recipient)
);
ALTER TABLE private.v2_push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.v2_reminder_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.v2_push_outbox,private.v2_reminder_ledger FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.v2_queue_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE singleton AND enabled) THEN
 INSERT INTO private.v2_push_outbox(notification_id,device_id)
 SELECT NEW.id,d.id FROM private.v2_push_devices d WHERE d.user_id=NEW.user_id
 ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_queue_push() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v2_queue_notification_delivery AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.v2_queue_push();
CREATE OR REPLACE FUNCTION public.v2_enqueue_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inserted_count integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE singleton AND enabled) THEN RETURN 0; END IF;
 -- Only committed upcoming visits. Dedupe by booking and exact arrival time.
 WITH due AS (
 SELECT 'doctor'::text AS kind,b.id AS target_id,b.appointment_at AS event_at,b.patient_id AS recipient FROM public.appointments b JOIN public.doctors d ON d.id=b.doctor_id WHERE b.status='approved' AND d.is_active AND d.admin_is_active AND d.subscription_expires_at>now() AND b.appointment_at>now() AND b.appointment_at<=now()+interval '24 hours'
 UNION ALL
 SELECT 'center',b.id,b.appointment_at,b.patient_id FROM public.center_appointments b JOIN public.medical_centers c ON c.id=b.center_id JOIN public.center_doctors cd ON cd.id=b.center_doctor_id AND cd.center_id=c.id WHERE b.status='confirmed' AND c.is_active AND c.subscription_expires_at>now() AND cd.is_active AND b.appointment_at>now() AND b.appointment_at<=now()+interval '24 hours'
 UNION ALL SELECT 'doctor_subscription',id,subscription_expires_at,profile_id FROM public.doctors WHERE subscription_expires_at>now() AND subscription_expires_at<=now()+interval '7 days'
 UNION ALL SELECT 'center_subscription',id,subscription_expires_at,profile_id FROM public.medical_centers WHERE subscription_expires_at>now() AND subscription_expires_at<=now()+interval '7 days'
 UNION ALL SELECT 'representative_subscription',profile_id,subscription_expires_at,profile_id FROM public.rep_accounts WHERE subscription_expires_at>now() AND subscription_expires_at<=now()+interval '7 days'
 UNION ALL SELECT 'home_subscription',id,subscription_expires_at,account_id FROM public.home_service_providers WHERE subscription_expires_at>now() AND subscription_expires_at<=now()+interval '7 days'
 ), fresh AS (
 INSERT INTO private.v2_reminder_ledger(kind,target_id,event_at,recipient)
 SELECT a.kind,a.target_id,a.event_at,a.recipient FROM due a JOIN public.profiles p ON p.id=a.recipient AND p.approval_status='approved'
 WHERE NOT EXISTS(SELECT 1 FROM private.v2_reminder_ledger l WHERE l.kind=a.kind AND l.target_id=a.target_id AND l.event_at=a.event_at AND l.recipient=a.recipient)
 ORDER BY a.event_at LIMIT 500 ON CONFLICT DO NOTHING RETURNING kind,recipient)
 INSERT INTO public.notifications(user_id,title,message)
 SELECT recipient,CASE WHEN kind LIKE '%subscription' THEN 'تنبيه الاشتراك' ELSE 'تذكير بموعدك' END,
 CASE WHEN kind LIKE '%subscription' THEN 'اشتراكك يقترب من الانتهاء، راجع لوحة الحساب.' ELSE 'لديك موعد خلال 24 ساعة، افتح بيشنت لمراجعة التفاصيل.' END FROM fresh;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION public.v2_enqueue_reminders() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_enqueue_reminders() TO service_role;
