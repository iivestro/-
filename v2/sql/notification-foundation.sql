-- Staging first. Messages deliberately contain no clinical notes or personal identifiers.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.v2_notification_edit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.title IS DISTINCT FROM OLD.title OR NEW.message IS DISTINCT FROM OLD.message OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'Notification content is immutable' USING ERRCODE='42501';
 END IF;
 IF auth.uid() IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Only recipient can mark notification read' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_notification_edit_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v2_notification_edit_guard BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION private.v2_notification_edit_guard();
CREATE OR REPLACE FUNCTION private.v2_notify_booking_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE heading text; body text;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.appointment_at IS NOT DISTINCT FROM OLD.appointment_at THEN RETURN NEW; END IF;
 heading:='تحديث الحجز';
 body:=CASE NEW.status
 WHEN 'approved' THEN 'تم قبول حجزك. راجع تفاصيل الموعد في التطبيق.'
 WHEN 'confirmed' THEN 'تم تأكيد حجزك. راجع تفاصيل الموعد في التطبيق.'
 WHEN 'rejected' THEN 'تم رفض طلب الحجز. راجع حجوزاتك في التطبيق.'
 WHEN 'cancelled' THEN 'تم إلغاء الحجز.'
 WHEN 'completed' THEN 'تم تحديث الحجز إلى مكتمل.'
 ELSE 'تم تحديث تفاصيل الحجز. راجع التطبيق.' END;
 INSERT INTO public.notifications(user_id,title,message) VALUES(NEW.patient_id,heading,body);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_notify_booking_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v2_notify_booking_status AFTER UPDATE OF status,appointment_at ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.v2_notify_booking_status();
CREATE TRIGGER v2_notify_booking_status AFTER UPDATE OF status,appointment_at ON public.center_appointments FOR EACH ROW EXECUTE FUNCTION private.v2_notify_booking_status();
CREATE INDEX idx_v2_notifications_user_unread ON public.notifications(user_id,id) WHERE NOT is_read;
COMMIT;
