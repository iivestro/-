-- Date-based appointment workflow and daily capacity controls.
-- Requires the existing PATIENT schema, center_decide_appointment(), and is_admin()/is_approved_user() helpers.

alter table public.appointments
  add column if not exists requested_date date,
  add column if not exists rejection_reason text,
  alter column appointment_at drop not null;

alter table public.doctor_schedules
  add column if not exists unlimited_daily boolean not null default true,
  add column if not exists max_daily_patients integer;

create index if not exists appointments_doctor_requested_date_status_idx
  on public.appointments (doctor_id, requested_date, status);

drop policy if exists approved_patients_create_appointments on public.appointments;
create policy approved_patients_create_appointments
on public.appointments for insert to authenticated
with check (
  patient_id = auth.uid()
  and status = 'pending'
  and appointment_at is null
  and requested_date is not null
  and requested_date >= (now() at time zone 'Asia/Baghdad')::date
  and public.is_approved_user()
  and exists (
    select 1 from public.doctors d
    join public.profiles p on p.id = d.profile_id
    where d.id = appointments.doctor_id
      and d.is_active is true
      and p.role = 'doctor'
      and p.approval_status = 'approved'
  )
);

create or replace function public.guard_appointments()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_doctor_profile_id uuid;
  v_doctor_active boolean;
  v_doctor_role text;
  v_doctor_approval text;
  v_patient_role text;
  v_patient_approval text;
  v_is_admin boolean;
  v_local_appointment timestamp without time zone;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or new.patient_id is distinct from auth.uid() then
      raise exception 'You may only create appointments for your own account' using errcode = '42501';
    end if;
    if new.status is distinct from 'pending' or new.appointment_at is not null or new.requested_date is null then
      raise exception 'New appointment requests must contain a date only and start pending';
    end if;
    if new.requested_date < (now() at time zone 'Asia/Baghdad')::date then
      raise exception 'Requested date must not be in the past';
    end if;
    if new.notes is not null and char_length(new.notes) > 1000 then
      raise exception 'Notes are too long (max 1000 characters)' using errcode = '23514';
    end if;
    select p.role, p.approval_status into v_patient_role, v_patient_approval
    from public.profiles p where p.id = new.patient_id;
    if v_patient_role is distinct from 'patient' or v_patient_approval is distinct from 'approved' then
      raise exception 'Only approved patients may book appointments' using errcode = '42501';
    end if;
    select d.profile_id, d.is_active, p.role, p.approval_status
      into v_doctor_profile_id, v_doctor_active, v_doctor_role, v_doctor_approval
    from public.doctors d join public.profiles p on p.id = d.profile_id
    where d.id = new.doctor_id;
    if not found or v_doctor_active is distinct from true
      or v_doctor_role is distinct from 'doctor'
      or v_doctor_approval is distinct from 'approved' then
      raise exception 'Doctor is not currently eligible for bookings';
    end if;
    if not exists (
      select 1 from public.doctor_schedules s
      where s.doctor_id = new.doctor_id
        and s.is_available is true
        and s.day_of_week = extract(dow from new.requested_date)::smallint
    ) then
      raise exception 'Doctor is not available on the requested date';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.patient_id is distinct from old.patient_id
    or new.doctor_id is distinct from old.doctor_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Appointment identity, owner, doctor and creation time cannot be changed' using errcode = '42501';
  end if;

  select d.profile_id into v_doctor_profile_id
  from public.doctors d where d.id = old.doctor_id;
  v_is_admin := public.is_admin();

  if not v_is_admin and auth.uid() is distinct from v_doctor_profile_id then
    if auth.uid() = old.patient_id
      and new.status = 'cancelled'
      and old.status in ('pending', 'approved', 'confirmed')
      and new.appointment_at is not distinct from old.appointment_at
      and new.requested_date is not distinct from old.requested_date
      and new.notes is not distinct from old.notes
      and new.rejection_reason is not distinct from old.rejection_reason then
      return new;
    end if;
    raise exception 'Only the assigned doctor or patient cancellation may update this appointment' using errcode = '42501';
  end if;

  if not v_is_admin and new.notes is distinct from old.notes then
    raise exception 'Patient notes cannot be edited' using errcode = '42501';
  end if;

  if new.appointment_at is not null and new.appointment_at is distinct from old.appointment_at then
    if new.appointment_at <= now() then raise exception 'Appointment time must be in the future'; end if;
    v_local_appointment := new.appointment_at at time zone 'Asia/Baghdad';
    if not exists (
      select 1 from public.doctor_schedules s
      where s.doctor_id = old.doctor_id
        and s.is_available is true
        and s.day_of_week = extract(dow from v_local_appointment)::smallint
        and v_local_appointment::time >= s.start_time
        and v_local_appointment::time < s.end_time
    ) then
      raise exception 'Appointment is outside the doctor schedule' using errcode = '23514';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'completed' and (new.appointment_at is null or new.appointment_at > now()) then
      raise exception 'A future appointment cannot be marked completed' using errcode = '23514';
    end if;
    if not v_is_admin and not (
      (old.status = 'pending' and new.status in ('approved', 'rejected'))
      or (old.status in ('approved', 'confirmed') and new.status in ('completed', 'rejected'))
    ) then
      raise exception 'Invalid appointment status transition' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.patient_request_doctor_appointment(
  p_doctor_id uuid, p_requested_date date, p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_doctor public.doctors%rowtype;
  v_appointment_id uuid;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'patient' and p.approval_status = 'approved'
  ) then raise exception 'Approved patient account required'; end if;
  if p_requested_date is null or p_requested_date < (now() at time zone 'Asia/Baghdad')::date then
    raise exception 'Choose a valid future date';
  end if;
  select * into v_doctor from public.doctors d
  where d.id = p_doctor_id and d.is_active is true for update;
  if not found or not exists (
    select 1 from public.profiles p
    where p.id = v_doctor.profile_id and p.role = 'doctor' and p.approval_status = 'approved'
  ) then raise exception 'Doctor is unavailable'; end if;
  if not exists (
    select 1 from public.doctor_schedules s
    where s.doctor_id = p_doctor_id
      and s.day_of_week = extract(dow from p_requested_date)::smallint
      and s.is_available is true
  ) then raise exception 'Doctor is not available on this date'; end if;
  insert into public.appointments(patient_id, doctor_id, requested_date, appointment_at, status, notes)
  values(v_uid, p_doctor_id, p_requested_date, null, 'pending', nullif(left(coalesce(p_notes, ''), 1000), ''))
  returning id into v_appointment_id;
  return jsonb_build_object('success', true, 'appointment_id', v_appointment_id, 'status', 'pending');
end;
$function$;

create or replace function public.doctor_decide_appointment(
  p_appointment_id uuid, p_action text,
  p_appointment_at timestamptz default null,
  p_rejection_reason text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_appointment public.appointments%rowtype;
  v_schedule public.doctor_schedules%rowtype;
  v_local_date date;
  v_local_time time;
  v_daily_unlimited boolean;
  v_daily_limit integer;
  v_confirmed_count integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select * into v_appointment from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'Appointment not found'; end if;

  if p_action = 'cancel' then
    if v_appointment.patient_id <> v_uid then raise exception 'Not authorized'; end if;
    if v_appointment.status not in ('pending', 'approved', 'confirmed') then raise exception 'Appointment cannot be cancelled'; end if;
    update public.appointments set status = 'cancelled' where id = p_appointment_id;
    return jsonb_build_object('success', true, 'status', 'cancelled');
  end if;

  perform 1 from public.doctors d join public.profiles p on p.id = d.profile_id
  where d.id = v_appointment.doctor_id and d.profile_id = v_uid and d.is_active is true
    and p.role = 'doctor' and p.approval_status = 'approved' for update of d;
  if not found then raise exception 'Not authorized to manage this appointment'; end if;

  if p_action = 'reject' then
    if v_appointment.status <> 'pending' then raise exception 'Only pending requests can be rejected'; end if;
    if nullif(btrim(coalesce(p_rejection_reason, '')), '') is null then raise exception 'A rejection reason is required'; end if;
    update public.appointments set status = 'rejected', appointment_at = null,
      rejection_reason = left(btrim(p_rejection_reason), 1000) where id = p_appointment_id;
    return jsonb_build_object('success', true, 'status', 'rejected');
  end if;
  if p_action = 'complete' then
    if v_appointment.status not in ('approved', 'confirmed') then raise exception 'Only confirmed appointments can be completed'; end if;
    update public.appointments set status = 'completed' where id = p_appointment_id;
    return jsonb_build_object('success', true, 'status', 'completed');
  end if;
  if p_action not in ('confirm', 'reschedule') then raise exception 'Invalid action'; end if;
  if p_appointment_at is null or p_appointment_at <= now() then raise exception 'A future appointment date and time is required'; end if;
  if p_action = 'confirm' and v_appointment.status <> 'pending' then raise exception 'Only pending requests can be confirmed'; end if;
  if p_action = 'reschedule' and v_appointment.status not in ('approved', 'confirmed') then raise exception 'Only confirmed appointments can be rescheduled'; end if;

  v_local_date := (p_appointment_at at time zone 'Asia/Baghdad')::date;
  v_local_time := (p_appointment_at at time zone 'Asia/Baghdad')::time;
  select * into v_schedule from public.doctor_schedules s
  where s.doctor_id = v_appointment.doctor_id
    and s.day_of_week = extract(dow from v_local_date)::smallint
    and s.is_available is true and s.start_time <= v_local_time and s.end_time > v_local_time
  order by s.start_time limit 1 for update;
  if not found then raise exception 'Selected time is outside the doctor schedule'; end if;

  select coalesce(bool_and(s.unlimited_daily), true),
    min(s.max_daily_patients) filter (where s.unlimited_daily is false)
  into v_daily_unlimited, v_daily_limit
  from public.doctor_schedules s
  where s.doctor_id = v_appointment.doctor_id
    and s.day_of_week = extract(dow from v_local_date)::smallint and s.is_available is true;
  if v_daily_unlimited is false then
    select count(*)::integer into v_confirmed_count from public.appointments a
    where a.doctor_id = v_appointment.doctor_id and a.requested_date = v_local_date
      and a.status in ('approved', 'confirmed', 'completed') and a.id <> p_appointment_id;
    if v_confirmed_count >= v_daily_limit then raise exception 'Daily appointment capacity is full'; end if;
  end if;

  update public.appointments set requested_date = v_local_date, appointment_at = p_appointment_at,
    status = 'approved', rejection_reason = null where id = p_appointment_id;
  return jsonb_build_object('success', true, 'status', 'approved',
    'requested_date', v_local_date, 'appointment_at', p_appointment_at);
end;
$function$;

create or replace function public.independent_doctor_appointment_dashboard_data()
returns table(
  appointment_id uuid, patient_id uuid, doctor_id uuid, requested_date date,
  appointment_at timestamptz, appointment_status text, appointment_notes text,
  rejection_reason text, created_at timestamptz, patient_name text,
  patient_age integer, patient_governorate text
)
language sql security definer set search_path = ''
as $function$
  select a.id, a.patient_id, a.doctor_id, a.requested_date, a.appointment_at,
    a.status, a.notes, a.rejection_reason, a.created_at, p.full_name, p.age, p.governorate
  from public.appointments a
  join public.profiles p on p.id = a.patient_id
  join public.doctors d on d.id = a.doctor_id
  join public.profiles dp on dp.id = d.profile_id
  where d.profile_id = auth.uid() and d.is_active is true
    and dp.role = 'doctor' and dp.approval_status = 'approved'
  order by coalesce(a.requested_date, (a.appointment_at at time zone 'Asia/Baghdad')::date), a.created_at;
$function$;

create or replace function public.center_appointment_dashboard_data()
returns table(
  appointment_id uuid, patient_id uuid, center_id uuid, center_doctor_id uuid,
  requested_date date, appointment_at timestamptz, appointment_status text,
  appointment_notes text, rejection_reason text, created_at timestamptz,
  patient_name text, patient_age integer, patient_governorate text,
  doctor_name text, doctor_specialty text, center_name text
)
language sql security definer set search_path = ''
as $function$
  select a.id, a.patient_id, a.center_id, a.center_doctor_id, a.requested_date,
    a.appointment_at, a.status, a.notes, a.rejection_reason, a.created_at,
    p.full_name, p.age, p.governorate, cd.full_name, cd.specialty, mc.name
  from public.center_appointments a
  join public.profiles p on p.id = a.patient_id
  join public.center_doctors cd on cd.id = a.center_doctor_id and cd.center_id = a.center_id
  join public.medical_centers mc on mc.id = a.center_id
  where (
    mc.profile_id = auth.uid() and mc.is_active is true
    and exists(select 1 from public.profiles cp where cp.id = auth.uid()
      and cp.role = 'medical_center' and cp.approval_status = 'approved')
  ) or (
    cd.profile_id = auth.uid() and cd.is_active is true
    and exists(select 1 from public.profiles dp where dp.id = auth.uid()
      and dp.role = 'doctor' and dp.approval_status = 'approved')
  ) or public.is_admin()
  order by a.requested_date, a.created_at;
$function$;

revoke all on function public.patient_request_doctor_appointment(uuid, date, text) from public, anon;
revoke all on function public.doctor_decide_appointment(uuid, text, timestamptz, text) from public, anon;
revoke all on function public.independent_doctor_appointment_dashboard_data() from public, anon;
revoke all on function public.center_appointment_dashboard_data() from public, anon;
grant execute on function public.patient_request_doctor_appointment(uuid, date, text) to authenticated;
grant execute on function public.doctor_decide_appointment(uuid, text, timestamptz, text) to authenticated;
grant execute on function public.independent_doctor_appointment_dashboard_data() to authenticated;
grant execute on function public.center_appointment_dashboard_data() to authenticated;

revoke insert, update on public.appointments from authenticated;
