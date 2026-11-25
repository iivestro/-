-- Staging proposal only. Review and test before applying; not a migration runner.
-- Assumption: pending, confirmed/approved and completed consume daily capacity.
-- If multiple blocks have different limits, use the smallest finite daily limit.
-- Date is provider-assigned arrival date if known, otherwise requested date (Baghdad).
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION private.v2_booking_capacity_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE provider uuid; effective_day date; active_count bigint; daily_limit integer; available_blocks bigint; valid_time boolean; center_booking boolean; is_admin boolean;
BEGIN
 center_booking := TG_TABLE_NAME='center_appointments';
 IF TG_OP='UPDATE' THEN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'Immutable booking identity' USING ERRCODE='42501';
  END IF;
  IF center_booking THEN
   IF NEW.center_id IS DISTINCT FROM OLD.center_id OR NEW.center_doctor_id IS DISTINCT FROM OLD.center_doctor_id THEN RAISE EXCEPTION 'Immutable provider' USING ERRCODE='42501'; END IF;
   is_admin := public.is_admin();
   IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
   IF NOT is_admin AND NEW.notes IS DISTINCT FROM OLD.notes THEN RAISE EXCEPTION 'Immutable patient notes' USING ERRCODE='42501'; END IF;
   IF NOT is_admin AND NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='pending' AND NEW.status IN ('confirmed','rejected','cancelled')) OR (OLD.status='confirmed' AND NEW.status IN ('completed','cancelled','rejected'))) THEN RAISE EXCEPTION 'Invalid status transition' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF TG_OP='INSERT' AND (auth.uid() IS NULL OR NEW.patient_id IS DISTINCT FROM auth.uid() OR NEW.status<>'pending' OR NEW.appointment_at IS NOT NULL OR NEW.requested_date IS NULL) THEN
  RAISE EXCEPTION 'Only own date-only pending requests are permitted' USING ERRCODE='42501';
 END IF;
 IF NEW.status NOT IN ('pending','approved','confirmed','completed') THEN RETURN NEW; END IF;
 IF NEW.status IN ('approved','confirmed','completed') AND NEW.appointment_at IS NULL THEN RAISE EXCEPTION 'Arrival time required' USING ERRCODE='23514'; END IF;
 IF NEW.status='completed' AND NEW.appointment_at>now() THEN RAISE EXCEPTION 'Future booking cannot be completed' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW.status='completed' AND OLD.status IN ('approved','confirmed') AND NEW.appointment_at IS NOT DISTINCT FROM OLD.appointment_at THEN RETURN NEW; END IF;
 effective_day := coalesce((NEW.appointment_at AT TIME ZONE 'Asia/Baghdad')::date,NEW.requested_date);
 IF effective_day IS NULL OR effective_day<(now() AT TIME ZONE 'Asia/Baghdad')::date THEN RAISE EXCEPTION 'Invalid booking date' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'Booking requires read committed isolation' USING ERRCODE='40001'; END IF;
 IF center_booking THEN provider:=NEW.center_doctor_id; ELSE provider:=NEW.doctor_id; END IF;
 -- Serialize all writers to a provider/day, including legacy direct REST requests.
 PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME||':'||provider::text||':'||effective_day::text,0));
 IF center_booking THEN
  IF NOT EXISTS (SELECT 1 FROM public.center_doctors d JOIN public.medical_centers c ON c.id=d.center_id JOIN public.profiles p ON p.id=d.profile_id WHERE d.id=provider AND c.id=NEW.center_id AND d.is_active AND c.is_active AND c.subscription_expires_at>now() AND p.role='doctor' AND p.approval_status='approved') THEN RAISE EXCEPTION 'Provider unavailable' USING ERRCODE='23514'; END IF;
  SELECT count(*),min(max_daily_patients) FILTER (WHERE NOT unlimited_daily),coalesce(bool_or(NEW.appointment_at IS NULL OR ((NEW.appointment_at AT TIME ZONE 'Asia/Baghdad')::time>=start_time AND (NEW.appointment_at AT TIME ZONE 'Asia/Baghdad')::time<end_time)),false) INTO available_blocks,daily_limit,valid_time FROM public.center_doctor_schedules WHERE center_doctor_id=provider AND is_available AND day_of_week=extract(dow FROM effective_day);
  SELECT count(*) INTO active_count FROM public.center_appointments WHERE center_doctor_id=provider AND id IS DISTINCT FROM NEW.id AND status IN ('pending','confirmed','completed') AND coalesce((appointment_at AT TIME ZONE 'Asia/Baghdad')::date,requested_date)=effective_day;
 ELSE
  IF NOT EXISTS (SELECT 1 FROM public.doctors d JOIN public.profiles p ON p.id=d.profile_id WHERE d.id=provider AND d.is_active AND d.admin_is_active AND d.subscription_expires_at>now() AND p.role='doctor' AND p.approval_status='approved') THEN RAISE EXCEPTION 'Provider unavailable' USING ERRCODE='23514'; END IF;
  SELECT count(*),min(max_daily_patients) FILTER (WHERE NOT unlimited_daily),coalesce(bool_or(NEW.appointment_at IS NULL OR ((NEW.appointment_at AT TIME ZONE 'Asia/Baghdad')::time>=start_time AND (NEW.appointment_at AT TIME ZONE 'Asia/Baghdad')::time<end_time)),false) INTO available_blocks,daily_limit,valid_time FROM public.doctor_schedules WHERE doctor_id=provider AND is_available AND day_of_week=extract(dow FROM effective_day);
  SELECT count(*) INTO active_count FROM public.appointments WHERE doctor_id=provider AND id IS DISTINCT FROM NEW.id AND status IN ('pending','approved','completed') AND coalesce((appointment_at AT TIME ZONE 'Asia/Baghdad')::date,requested_date)=effective_day;
 END IF;
 IF available_blocks=0 OR NOT valid_time THEN RAISE EXCEPTION 'Outside provider schedule' USING ERRCODE='23514'; END IF;
 IF daily_limit IS NOT NULL AND active_count>=daily_limit THEN RAISE EXCEPTION 'Daily capacity reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_booking_capacity_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER zz_v2_booking_capacity_guard BEFORE INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.v2_booking_capacity_guard();
CREATE TRIGGER zz_v2_booking_capacity_guard BEFORE INSERT OR UPDATE ON public.center_appointments FOR EACH ROW EXECUTE FUNCTION private.v2_booking_capacity_guard();
COMMIT;
-- Required before enabling: duplicate indexes, capacity query indexes, concurrent transaction tests,
-- center authorization/state tests, schedule/subscription edit races, legacy compatibility and rollback.
-- Rollback: drop triggers on both tables, then drop private.v2_booking_capacity_guard().
