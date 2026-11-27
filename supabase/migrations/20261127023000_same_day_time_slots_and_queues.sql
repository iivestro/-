-- Same-day and next-day appointments, provider visit windows, and queue positions.
alter table public.home_service_requests
  add column if not exists arrival_date date;

CREATE OR REPLACE FUNCTION public.center_decide_appointment(p_appointment_id uuid, p_action text, p_appointment_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_appointment public.center_appointments%rowtype;
  v_center_owner boolean:=false;
  v_assigned_doctor boolean:=false;
  v_schedule public.center_doctor_schedules%rowtype;
  v_today date := (pg_catalog.now() at time zone 'Asia/Baghdad')::date;
  v_local_date date;
  v_local_time time;
  v_confirmed_count integer;
  v_daily_unlimited boolean;
  v_daily_limit integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_appointment from public.center_appointments where id=p_appointment_id for update;
  if not found then raise exception 'Appointment not found'; end if;
  select exists(select 1 from public.medical_centers mc join public.profiles p on p.id=mc.profile_id
    where mc.id=v_appointment.center_id and mc.profile_id=v_uid and mc.is_active is true and p.role='medical_center' and p.approval_status='approved')
    into v_center_owner;
  select exists(select 1 from public.center_doctors cd join public.profiles p on p.id=cd.profile_id
    where cd.id=v_appointment.center_doctor_id and cd.center_id=v_appointment.center_id and cd.profile_id=v_uid
      and cd.is_active is true and p.role='doctor' and p.approval_status='approved')
    into v_assigned_doctor;
  if p_action='cancel' then
    if v_appointment.patient_id<>v_uid then raise exception 'Not authorized to cancel this appointment'; end if;
    if v_appointment.status not in ('pending','approved','confirmed') then raise exception 'Only pending or confirmed appointments can be cancelled'; end if;
    update public.center_appointments set status='cancelled' where id=p_appointment_id;
    return jsonb_build_object('success',true,'status','cancelled');
  end if;
  if not(v_center_owner or v_assigned_doctor) then raise exception 'Not authorized to manage this appointment'; end if;
  if p_action='reject' then
    if v_appointment.status<>'pending' then raise exception 'Only pending requests can be rejected'; end if;
    if nullif(pg_catalog.btrim(coalesce(p_rejection_reason,'')),'') is null then raise exception 'A rejection reason is required'; end if;
    update public.center_appointments set status='rejected',rejection_reason=pg_catalog.left(pg_catalog.btrim(p_rejection_reason),1000),appointment_at=null where id=p_appointment_id;
    return jsonb_build_object('success',true,'status','rejected');
  end if;
  if p_action='complete' then
    if v_appointment.status not in ('approved','confirmed') or v_appointment.appointment_at is null or v_appointment.appointment_at>pg_catalog.now() then
      raise exception 'Only past confirmed appointments can be completed';
    end if;
    update public.center_appointments set status='completed' where id=p_appointment_id;
    return jsonb_build_object('success',true,'status','completed');
  end if;
  if p_action not in ('confirm','reschedule') then raise exception 'Invalid action'; end if;
  if p_appointment_at is null or p_appointment_at<=pg_catalog.now() then raise exception 'اختر وقتاً مستقبلاً اليوم أو غداً'; end if;
  if p_action='confirm' and v_appointment.status<>'pending' then raise exception 'Only pending requests can be confirmed'; end if;
  if p_action='reschedule' and v_appointment.status not in ('approved','confirmed') then raise exception 'Only confirmed appointments can be rescheduled'; end if;
  v_local_date:=(p_appointment_at at time zone 'Asia/Baghdad')::date;
  v_local_time:=(p_appointment_at at time zone 'Asia/Baghdad')::time;
  if v_local_date not between v_today and v_today+1 then raise exception 'اختر اليوم أو غداً فقط'; end if;
  perform 1 from public.center_doctors cd where cd.id=v_appointment.center_doctor_id and cd.center_id=v_appointment.center_id for update;
  select * into v_schedule from public.center_doctor_schedules s
  where s.center_doctor_id=v_appointment.center_doctor_id and s.day_of_week=extract(dow from v_local_date)::smallint
    and s.is_available is true and s.start_time<=v_local_time and s.end_time>v_local_time
  order by s.start_time limit 1 for update;
  if not found then raise exception 'الوقت المختار خارج دوام الطبيب'; end if;
  select coalesce(bool_and(s.unlimited_daily),true),min(s.max_daily_patients) filter(where s.unlimited_daily is false)
  into v_daily_unlimited,v_daily_limit from public.center_doctor_schedules s
  where s.center_doctor_id=v_appointment.center_doctor_id and s.day_of_week=extract(dow from v_local_date)::smallint and s.is_available is true;
  if v_daily_unlimited is false then
    select count(*)::integer into v_confirmed_count from public.center_appointments a
    where a.center_doctor_id=v_appointment.center_doctor_id and a.requested_date=v_local_date
      and a.status in ('approved','confirmed','completed') and a.id<>p_appointment_id;
    if v_confirmed_count>=v_daily_limit then raise exception 'اكتمل الحد اليومي لمواعيد المركز'; end if;
  end if;
  update public.center_appointments set requested_date=v_local_date,appointment_at=p_appointment_at,status='confirmed',rejection_reason=null where id=p_appointment_id;
  return jsonb_build_object('success',true,'status','confirmed','requested_date',v_local_date,'appointment_at',p_appointment_at);
end;
$function$;


CREATE OR REPLACE FUNCTION public.doctor_create_rep_visit_slot(p_start_time time without time zone, p_end_time time without time zone, p_capacity smallint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_doctor_id uuid;
  v_today date := (pg_catalog.now() at time zone 'Asia/Baghdad')::date;
  v_now_time time := (pg_catalog.now() at time zone 'Asia/Baghdad')::time;
  v_slot_id uuid;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode='42501'; end if;
  select d.id into v_doctor_id
  from public.doctors d join public.profiles p on p.id=d.profile_id
  where d.profile_id=v_uid and d.is_active is true and p.role='doctor' and p.approval_status='approved'
  for update of d;
  if not found then raise exception 'حساب الطبيب غير معتمد أو غير نشط' using errcode='42501'; end if;
  if p_start_time is null or p_end_time is null or p_end_time<=p_start_time then
    raise exception 'حدد وقت بداية ونهاية صحيحين.';
  end if;
  if p_capacity is null or p_capacity<1 or p_capacity>30 then
    raise exception 'عدد المندوبين يجب أن يكون بين 1 و30.';
  end if;
  if p_start_time<=v_now_time then raise exception 'يجب أن يبدأ وقت الاستقبال بعد الوقت الحالي.'; end if;
  if exists (
    select 1 from public.rep_visit_slots s
    where s.doctor_id=v_doctor_id and s.visit_date=v_today and s.is_open is true
      and p_start_time<s.end_time and p_end_time>s.start_time
  ) then raise exception 'يتداخل هذا الوقت مع فترة استقبال مفتوحة أخرى.'; end if;
  update public.rep_visit_slots set is_open=false
  where doctor_id=v_doctor_id and visit_date<>v_today and is_open is true;
  insert into public.rep_visit_slots(doctor_id,visit_date,start_time,end_time,capacity,is_open)
  values(v_doctor_id,v_today,p_start_time,p_end_time,p_capacity,true)
  returning id into v_slot_id;
  return v_slot_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.doctor_decide_appointment(p_appointment_id uuid, p_action text, p_appointment_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_appointment public.appointments%rowtype;
  v_schedule public.doctor_schedules%rowtype;
  v_today date := (pg_catalog.now() at time zone 'Asia/Baghdad')::date;
  v_local_date date;
  v_local_time time;
  v_daily_unlimited boolean;
  v_daily_limit integer;
  v_confirmed_count integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_appointment from public.appointments where id=p_appointment_id for update;
  if not found then raise exception 'Appointment not found'; end if;
  if p_action='cancel' then
    if v_appointment.patient_id<>v_uid then raise exception 'Not authorized to cancel this appointment'; end if;
    if v_appointment.status not in ('pending','approved','confirmed') then raise exception 'Appointment cannot be cancelled'; end if;
    update public.appointments set status='cancelled' where id=p_appointment_id;
    return jsonb_build_object('success',true,'status','cancelled');
  end if;
  perform 1 from public.doctors d join public.profiles p on p.id=d.profile_id
  where d.id=v_appointment.doctor_id and d.profile_id=v_uid and d.is_active is true and p.role='doctor' and p.approval_status='approved'
  for update of d;
  if not found then raise exception 'Not authorized to manage this appointment'; end if;
  if p_action='reject' then
    if v_appointment.status<>'pending' then raise exception 'Only pending requests can be rejected'; end if;
    if nullif(pg_catalog.btrim(coalesce(p_rejection_reason,'')),'') is null then raise exception 'A rejection reason is required'; end if;
    update public.appointments set status='rejected',appointment_at=null,rejection_reason=pg_catalog.left(pg_catalog.btrim(p_rejection_reason),1000)
    where id=p_appointment_id;
    return jsonb_build_object('success',true,'status','rejected');
  end if;
  if p_action='complete' then
    if v_appointment.status not in ('approved','confirmed') then raise exception 'Only confirmed appointments can be completed'; end if;
    update public.appointments set status='completed' where id=p_appointment_id;
    return jsonb_build_object('success',true,'status','completed');
  end if;
  if p_action not in ('confirm','reschedule') then raise exception 'Invalid action'; end if;
  if p_appointment_at is null or p_appointment_at<=pg_catalog.now() then raise exception 'اختر وقتاً مستقبلاً اليوم أو غداً'; end if;
  if p_action='confirm' and v_appointment.status<>'pending' then raise exception 'Only pending requests can be confirmed'; end if;
  if p_action='reschedule' and v_appointment.status not in ('approved','confirmed') then raise exception 'Only confirmed appointments can be rescheduled'; end if;
  v_local_date:=(p_appointment_at at time zone 'Asia/Baghdad')::date;
  v_local_time:=(p_appointment_at at time zone 'Asia/Baghdad')::time;
  if v_local_date not between v_today and v_today+1 then raise exception 'اختر اليوم أو غداً فقط'; end if;
  select * into v_schedule from public.doctor_schedules s
  where s.doctor_id=v_appointment.doctor_id and s.day_of_week=extract(dow from v_local_date)::smallint
    and s.is_available is true and s.start_time<=v_local_time and s.end_time>v_local_time
  order by s.start_time limit 1 for update;
  if not found then raise exception 'الوقت المختار خارج دوام الطبيب'; end if;
  select coalesce(bool_and(s.unlimited_daily),true),min(s.max_daily_patients) filter(where s.unlimited_daily is false)
  into v_daily_unlimited,v_daily_limit from public.doctor_schedules s
  where s.doctor_id=v_appointment.doctor_id and s.day_of_week=extract(dow from v_local_date)::smallint and s.is_available is true;
  if v_daily_unlimited is false then
    select count(*)::integer into v_confirmed_count from public.appointments a
    where a.doctor_id=v_appointment.doctor_id and a.requested_date=v_local_date and a.status in ('approved','confirmed','completed') and a.id<>p_appointment_id;
    if v_confirmed_count>=v_daily_limit then raise exception 'اكتمل الحد اليومي لمواعيد الطبيب'; end if;
  end if;
  update public.appointments set requested_date=v_local_date,appointment_at=p_appointment_at,status='approved',rejection_reason=null where id=p_appointment_id;
  return jsonb_build_object('success',true,'status','approved','requested_date',v_local_date,'appointment_at',p_appointment_at);
end;
$function$;


CREATE OR REPLACE FUNCTION public.patient_appointment_queue_data()
 RETURNS TABLE(appointment_id uuid, service_type text, queue_position integer, patients_ahead integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    select a.id as appointment_id,'doctor'::text as service_type,a.doctor_id as provider_id,
      (a.appointment_at at time zone 'Asia/Baghdad')::date as service_date,a.appointment_at,a.created_at
    from public.appointments a where a.patient_id=(select auth.uid()) and a.status in ('approved','confirmed') and a.appointment_at is not null
    union all
    select a.id,'center'::text,a.center_doctor_id,
      (a.appointment_at at time zone 'Asia/Baghdad')::date,a.appointment_at,a.created_at
    from public.center_appointments a where a.patient_id=(select auth.uid()) and a.status in ('approved','confirmed') and a.appointment_at is not null
  ),
  active as (
    select a.id as appointment_id,'doctor'::text as service_type,a.doctor_id as provider_id,
      (a.appointment_at at time zone 'Asia/Baghdad')::date as service_date,a.appointment_at,a.created_at
    from public.appointments a where a.status in ('approved','confirmed') and a.appointment_at is not null
    union all
    select a.id,'center'::text,a.center_doctor_id,
      (a.appointment_at at time zone 'Asia/Baghdad')::date,a.appointment_at,a.created_at
    from public.center_appointments a where a.status in ('approved','confirmed') and a.appointment_at is not null
  )
  select m.appointment_id,m.service_type,(count(a.appointment_id)+1)::integer,count(a.appointment_id)::integer
  from mine m left join active a on a.service_type=m.service_type and a.provider_id=m.provider_id and a.service_date=m.service_date
    and (a.appointment_at<m.appointment_at or (a.appointment_at=m.appointment_at and
      (a.created_at<m.created_at or (a.created_at=m.created_at and a.appointment_id<m.appointment_id))))
  where exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='patient')
  group by m.appointment_id,m.service_type,m.appointment_at,m.created_at;
$function$;


CREATE OR REPLACE FUNCTION public.patient_request_doctor_appointment(p_doctor_id uuid, p_requested_date date, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_doctor public.doctors%rowtype;
  v_appointment_id uuid;
  v_today date := (pg_catalog.now() at time zone 'Asia/Baghdad')::date;
  v_daily_unlimited boolean;
  v_daily_limit integer;
  v_booked_count integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.role='patient' and p.approval_status='approved') then
    raise exception 'Approved patient account required';
  end if;
  if p_requested_date is null or p_requested_date not between v_today and v_today+1 then raise exception 'اختر اليوم أو غداً فقط'; end if;
  select * into v_doctor from public.doctors d where d.id=p_doctor_id and d.is_active is true for update;
  if not found or not exists(select 1 from public.profiles p where p.id=v_doctor.profile_id and p.role='doctor' and p.approval_status='approved') then
    raise exception 'الطبيب غير متاح حالياً';
  end if;
  if not exists(select 1 from public.doctor_schedules s where s.doctor_id=p_doctor_id
    and s.day_of_week=extract(dow from p_requested_date)::smallint and s.is_available is true) then
    raise exception 'الطبيب لا يستقبل المراجعين في هذا اليوم';
  end if;
  select coalesce(bool_and(s.unlimited_daily),true),min(s.max_daily_patients) filter(where s.unlimited_daily is false)
  into v_daily_unlimited,v_daily_limit from public.doctor_schedules s
  where s.doctor_id=p_doctor_id and s.day_of_week=extract(dow from p_requested_date)::smallint and s.is_available is true;
  if v_daily_unlimited is false then
    select count(*)::integer into v_booked_count from public.appointments a
    where a.doctor_id=p_doctor_id and a.requested_date=p_requested_date and a.status in ('pending','approved','confirmed','completed');
    if v_booked_count>=v_daily_limit then raise exception 'اكتمل عدد الحجوزات المتاح للطبيب في هذا اليوم'; end if;
  end if;
  insert into public.appointments(patient_id,doctor_id,requested_date,appointment_at,status,notes)
  values(v_uid,p_doctor_id,p_requested_date,null,'pending',nullif(pg_catalog.left(coalesce(p_notes,''),1000),''))
  returning id into v_appointment_id;
  return jsonb_build_object('success',true,'appointment_id',v_appointment_id,'status','pending');
end;
$function$;


CREATE OR REPLACE FUNCTION public.home_service_accept(p_request uuid, p_lat double precision, p_lon double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date:=(pg_catalog.now() at time zone 'Asia/Baghdad')::date;
begin
  update public.home_service_requests r set status='confirmed'
  where r.id=p_request and r.patient_id=(select auth.uid()) and r.status='quoted'
    and coalesce(r.arrival_date,(r.scheduled_at at time zone 'Asia/Baghdad')::date,v_today) between v_today and v_today+1
    and coalesce(r.arrival_time,pg_catalog.timezone('Asia/Baghdad',r.scheduled_at)::time) is not null
    and ((coalesce(r.arrival_date,(r.scheduled_at at time zone 'Asia/Baghdad')::date,v_today)
      +coalesce(r.arrival_time,pg_catalog.timezone('Asia/Baghdad',r.scheduled_at)::time)) at time zone 'Asia/Baghdad')>pg_catalog.now();
  if not found then raise exception 'Request unavailable'; end if;
  insert into public.home_service_locations(request_id,latitude,longitude) values(p_request,p_lat,p_lon);
end;
$function$;


CREATE OR REPLACE FUNCTION public.home_service_accept_saved(p_request uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date:=(pg_catalog.now() at time zone 'Asia/Baghdad')::date;
begin
  update public.home_service_requests r set status='confirmed'
  where r.id=p_request and r.patient_id=(select auth.uid()) and r.status='quoted'
    and coalesce(r.arrival_date,(r.scheduled_at at time zone 'Asia/Baghdad')::date,v_today) between v_today and v_today+1
    and coalesce(r.arrival_time,pg_catalog.timezone('Asia/Baghdad',r.scheduled_at)::time) is not null
    and ((coalesce(r.arrival_date,(r.scheduled_at at time zone 'Asia/Baghdad')::date,v_today)
      +coalesce(r.arrival_time,pg_catalog.timezone('Asia/Baghdad',r.scheduled_at)::time)) at time zone 'Asia/Baghdad')>pg_catalog.now()
    and exists(select 1 from public.home_service_locations l where l.request_id=r.id);
  if not found then raise exception 'Request unavailable'; end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.home_service_patient_queue_positions()
 RETURNS TABLE(request_id uuid, queue_position integer, patients_ahead integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select mine.id,(count(ahead.id)+1)::integer,count(ahead.id)::integer
  from public.home_service_requests mine
  left join public.home_service_requests ahead
    on ahead.provider_id=mine.provider_id
    and coalesce(ahead.arrival_date,(ahead.scheduled_at at time zone 'Asia/Baghdad')::date,(ahead.created_at at time zone 'Asia/Baghdad')::date)
      =coalesce(mine.arrival_date,(mine.scheduled_at at time zone 'Asia/Baghdad')::date,(mine.created_at at time zone 'Asia/Baghdad')::date)
    and ahead.status in ('confirmed','en_route','arrived')
    and (
      coalesce(ahead.arrival_time,pg_catalog.timezone('Asia/Baghdad',ahead.scheduled_at)::time)
        <coalesce(mine.arrival_time,pg_catalog.timezone('Asia/Baghdad',mine.scheduled_at)::time)
      or (
        coalesce(ahead.arrival_time,pg_catalog.timezone('Asia/Baghdad',ahead.scheduled_at)::time)
          =coalesce(mine.arrival_time,pg_catalog.timezone('Asia/Baghdad',mine.scheduled_at)::time)
        and (ahead.created_at<mine.created_at or (ahead.created_at=mine.created_at and ahead.id<mine.id))
      )
    )
  where mine.patient_id=(select auth.uid()) and mine.status in ('confirmed','en_route','arrived') and mine.arrival_time is not null
    and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='patient')
  group by mine.id;
$function$;


CREATE OR REPLACE FUNCTION public.home_service_progress(p_request uuid, p_status text, p_price integer DEFAULT NULL::integer, p_time text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_arrival_date date;
  v_arrival_time time;
  v_time_text text:=nullif(pg_catalog.btrim(p_time),'');
  v_local_timestamp timestamp without time zone;
  v_today date:=(pg_catalog.now() at time zone 'Asia/Baghdad')::date;
begin
  if p_status='quoted' then
    if v_time_text is null or pg_catalog.length(v_time_text)>64 then raise exception using errcode='22007',message='أدخل وقت الوصول بشكل صحيح.'; end if;
    if v_time_text ~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?$' then
      v_arrival_date:=v_today; v_arrival_time:=v_time_text::time;
    elsif v_time_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' then
      begin
        if v_time_text ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then v_local_timestamp:=pg_catalog.timezone('Asia/Baghdad',v_time_text::timestamptz);
        else v_local_timestamp:=v_time_text::timestamp; end if;
        v_arrival_date:=v_local_timestamp::date; v_arrival_time:=v_local_timestamp::time;
      exception when others then raise exception using errcode='22007',message='أدخل وقت وصول صالحاً.'; end;
    else raise exception using errcode='22007',message='أدخل وقت الوصول أو اختر اليوم وغداً.'; end if;
    if v_arrival_date not between v_today and v_today+1 then raise exception using errcode='22007',message='موعد الزيارة يجب أن يكون اليوم أو غداً.'; end if;
    if ((v_arrival_date+v_arrival_time) at time zone 'Asia/Baghdad')<=pg_catalog.now() then raise exception using errcode='22007',message='اختر وقت وصول مستقبلياً.'; end if;
  end if;
  update public.home_service_requests r
  set status=p_status,
      quoted_price=case when p_status='quoted' then p_price else r.quoted_price end,
      arrival_date=case when p_status='quoted' then v_arrival_date else r.arrival_date end,
      arrival_time=case when p_status='quoted' then v_arrival_time else r.arrival_time end,
      scheduled_at=case when p_status='quoted' then null else r.scheduled_at end
  where r.id=p_request and exists(select 1 from public.home_service_providers p where p.id=r.provider_id and p.account_id=(select auth.uid())
    and p.approved and (r.status<>'pending' or p.subscription_expires_at>pg_catalog.now()))
    and ((r.status='pending' and p_status='quoted' and p_price>=0 and v_arrival_time is not null)
      or (r.status='confirmed' and p_status='en_route') or (r.status='en_route' and p_status='arrived') or (r.status='arrived' and p_status='completed'));
  if not found then raise exception 'Invalid transition'; end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.home_service_provider_requests_v2()
 RETURNS TABLE(id uuid, description text, status text, quoted_price integer, arrival_date date, arrival_time time without time zone, patient_name text, patient_phone text, visit_address text, latitude double precision, longitude double precision, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id,r.description,r.status,r.quoted_price,
    coalesce(r.arrival_date,(r.scheduled_at at time zone 'Asia/Baghdad')::date,(r.created_at at time zone 'Asia/Baghdad')::date),
    coalesce(r.arrival_time,pg_catalog.timezone('Asia/Baghdad',r.scheduled_at)::time),
    coalesce(nullif(pg_catalog.btrim(patient.full_name),''),'المراجع'),
    coalesce(nullif(pg_catalog.btrim(r.contact_phone),''),nullif(pg_catalog.btrim(patient.phone),'')),
    location.address,location.latitude,location.longitude,r.created_at
  from public.home_service_requests r join public.home_service_providers provider on provider.id=r.provider_id
  left join public.profiles patient on patient.id=r.patient_id
  left join public.home_service_locations location on location.request_id=r.id
  where provider.account_id=(select auth.uid()) and provider.approved order by r.created_at desc;
$function$;


revoke all on function public.doctor_create_rep_visit_slot(time without time zone,time without time zone,smallint) from public, anon;
grant execute on function public.doctor_create_rep_visit_slot(time without time zone,time without time zone,smallint) to authenticated, service_role;
revoke all on function public.patient_request_doctor_appointment(uuid,date,text) from public, anon;
grant execute on function public.patient_request_doctor_appointment(uuid,date,text) to authenticated, service_role;
revoke all on function public.doctor_decide_appointment(uuid,text,timestamp with time zone,text) from public, anon;
grant execute on function public.doctor_decide_appointment(uuid,text,timestamp with time zone,text) to authenticated, service_role;
revoke all on function public.center_decide_appointment(uuid,text,timestamp with time zone,text) from public, anon;
grant execute on function public.center_decide_appointment(uuid,text,timestamp with time zone,text) to authenticated, service_role;
revoke all on function public.patient_appointment_queue_data() from public, anon;
grant execute on function public.patient_appointment_queue_data() to authenticated, service_role;
revoke all on function public.home_service_progress(uuid,text,integer,text) from public, anon;
grant execute on function public.home_service_progress(uuid,text,integer,text) to authenticated, service_role;
revoke all on function public.home_service_provider_requests_v2() from public, anon;
grant execute on function public.home_service_provider_requests_v2() to authenticated, service_role;
revoke all on function public.home_service_accept_saved(uuid) from public, anon;
grant execute on function public.home_service_accept_saved(uuid) to authenticated, service_role;
revoke all on function public.home_service_accept(uuid,double precision,double precision) from public, anon;
grant execute on function public.home_service_accept(uuid,double precision,double precision) to authenticated, service_role;
revoke all on function public.home_service_patient_queue_positions() from public, anon;
grant execute on function public.home_service_patient_queue_positions() to authenticated, service_role;

do $migration$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job
  where jobname='balsam-expire-rep-visit-slots';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
  perform cron.schedule(
    'balsam-expire-rep-visit-slots',
    '0 21 * * *',
    $job$
      update public.rep_visit_slots
      set is_open=false
      where visit_date < (pg_catalog.now() at time zone 'Asia/Baghdad')::date
        and is_open is true;
    $job$
  );
end
$migration$;

notify pgrst, 'reload schema';
