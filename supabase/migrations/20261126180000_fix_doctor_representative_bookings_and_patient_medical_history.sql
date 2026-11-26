-- Patient booking capacity, representative visit rules and private medical history.
-- Safe to reapply: all schema objects are created conditionally or replaced by signature.

create or replace function public.patient_request_doctor_appointment(
  p_doctor_id uuid, p_requested_date date, p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_doctor public.doctors%rowtype;
  v_appointment_id uuid;
  v_daily_unlimited boolean;
  v_daily_limit integer;
  v_booked_count integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'patient' and p.approval_status = 'approved'
  ) then raise exception 'Approved patient account required'; end if;
  if p_requested_date is null or p_requested_date < (now() at time zone 'Asia/Baghdad')::date then
    raise exception 'اختر تاريخاً صالحاً غير سابق';
  end if;

  select * into v_doctor from public.doctors d
  where d.id = p_doctor_id and d.is_active is true for update;
  if not found or not exists (
    select 1 from public.profiles p
    where p.id = v_doctor.profile_id and p.role = 'doctor' and p.approval_status = 'approved'
  ) then raise exception 'الطبيب غير متاح حالياً'; end if;

  if not exists (
    select 1 from public.doctor_schedules s
    where s.doctor_id = p_doctor_id
      and s.day_of_week = extract(dow from p_requested_date)::smallint
      and s.is_available is true
  ) then raise exception 'الطبيب لا يستقبل المراجعين في هذا اليوم'; end if;

  select coalesce(bool_and(s.unlimited_daily), true),
    min(s.max_daily_patients) filter (where s.unlimited_daily is false)
  into v_daily_unlimited, v_daily_limit
  from public.doctor_schedules s
  where s.doctor_id = p_doctor_id
    and s.day_of_week = extract(dow from p_requested_date)::smallint
    and s.is_available is true;

  if v_daily_unlimited is false then
    select count(*)::integer into v_booked_count
    from public.appointments a
    where a.doctor_id = p_doctor_id
      and a.requested_date = p_requested_date
      and a.status in ('pending', 'approved', 'confirmed', 'completed');
    if v_booked_count >= v_daily_limit then
      raise exception 'اكتمل عدد الحجوزات المتاح للطبيب في هذا اليوم';
    end if;
  end if;

  insert into public.appointments(patient_id, doctor_id, requested_date, appointment_at, status, notes)
  values (v_uid, p_doctor_id, p_requested_date, null, 'pending', nullif(left(coalesce(p_notes, ''), 1000), ''))
  returning id into v_appointment_id;

  return jsonb_build_object('success', true, 'appointment_id', v_appointment_id, 'status', 'pending');
end;
$function$;

alter table public.rep_appointments
  add column if not exists visit_at timestamptz;

create or replace function public.book_rep_visit(p_slot_id uuid, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_slot public.rep_visit_slots%rowtype;
  v_count integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'يجب تسجيل الدخول' using errcode = '42501';
  end if;

  perform 1 from public.profiles p where p.id = v_uid for update;

  if not exists (
    select 1 from public.profiles p
    join public.rep_accounts r on r.profile_id = p.id
    where p.id = v_uid and p.role = 'representative'
      and p.approval_status = 'approved' and r.status = 'approved'
      and r.subscription_expires_at > now()
  ) then
    raise exception 'اشتراك المندوب منتهٍ أو الحساب غير معتمد أو موقوف' using errcode = '42501';
  end if;

  select * into v_slot from public.rep_visit_slots where id = p_slot_id for update;
  if not found or v_slot.is_open is not true then
    raise exception 'الحجز مغلق أو الموعد غير متاح';
  end if;
  if (v_slot.visit_date + v_slot.start_time) <= (now() at time zone 'Asia/Baghdad') then
    raise exception 'لا يمكن حجز موعد مضى';
  end if;
  if not exists (
    select 1 from public.doctors d
    join public.profiles dp on dp.id = d.profile_id
    where d.id = v_slot.doctor_id and d.is_active is true
      and dp.role = 'doctor' and dp.approval_status = 'approved'
  ) then
    raise exception 'الطبيب غير متاح حالياً أو غير معتمد';
  end if;

  if exists (
    select 1 from public.rep_appointments a
    join public.rep_visit_slots previous_slot on previous_slot.id = a.slot_id
    where a.rep_profile_id = v_uid and a.doctor_id = v_slot.doctor_id
      and a.status in ('pending', 'approved', 'completed')
      and abs(extract(epoch from
        ((v_slot.visit_date + v_slot.start_time) -
         (previous_slot.visit_date + previous_slot.start_time)))) < 86400
  ) then
    raise exception 'يمكنك حجز زيارة واحدة للطبيب خلال كل 24 ساعة';
  end if;

  select count(*) into v_count from public.rep_appointments a
  where a.slot_id = p_slot_id and a.status in ('pending', 'approved');
  if v_count >= v_slot.capacity then
    raise exception 'اكتمل عدد الحجوزات لهذا الموعد';
  end if;

  insert into public.rep_appointments(slot_id, doctor_id, rep_profile_id, notes)
  values (v_slot.id, v_slot.doctor_id, v_uid, nullif(pg_catalog.left(coalesce(p_notes, ''), 500), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

drop function if exists public.doctor_update_rep_appointment(uuid, text);
create function public.doctor_update_rep_appointment(
  p_appointment_id uuid, p_new_status text, p_visit_at timestamptz default null
)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '42501'; end if;
  if p_new_status not in ('approved', 'rejected', 'completed') then
    raise exception 'حالة الحجز غير صالحة' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles p join public.doctors d on d.profile_id = p.id
    where p.id = v_uid and p.role = 'doctor' and p.approval_status = 'approved' and d.is_active is true
  ) then raise exception 'حساب الطبيب غير معتمد أو غير نشط' using errcode = '42501'; end if;

  if p_new_status = 'approved' and p_visit_at is null then
    raise exception 'اختر وقت دخول المندوب';
  end if;

  update public.rep_appointments a
  set status = p_new_status, visit_at = case when p_new_status = 'approved' then p_visit_at else null end,
      updated_at = now()
  from public.doctors d, public.rep_visit_slots s
  where a.id = p_appointment_id and s.id = a.slot_id
    and d.id = a.doctor_id and d.profile_id = v_uid and d.is_active is true
    and (
      (a.status = 'pending' and p_new_status in ('approved', 'rejected'))
      or (a.status = 'approved' and p_new_status = 'completed')
    )
    and (
      p_new_status <> 'approved'
      or (
        p_visit_at > now()
        and (p_visit_at at time zone 'Asia/Baghdad')::date = s.visit_date
        and (p_visit_at at time zone 'Asia/Baghdad')::time >= s.start_time
        and (p_visit_at at time zone 'Asia/Baghdad')::time < s.end_time
      )
    );

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'اختر وقتاً ضمن فترة الموعد المحددة أو تحقق من حالة الطلب'
      using errcode = '42501';
  end if;
  return true;
end;
$function$;

revoke all on function public.book_rep_visit(uuid, text) from public, anon;
grant execute on function public.book_rep_visit(uuid, text) to authenticated;
revoke all on function public.doctor_update_rep_appointment(uuid, text, timestamptz) from public, anon;
grant execute on function public.doctor_update_rep_appointment(uuid, text, timestamptz) to authenticated;

drop function if exists public.doctor_rep_appointment_details_v2();
create function public.doctor_rep_appointment_details_v2()
returns table(
  appointment_id uuid, slot_id uuid, rep_profile_id uuid, rep_name text,
  rep_age integer, employer_name text, employer_type text, governorate text,
  visit_date date, start_time time, end_time time, visit_at timestamptz,
  capacity smallint, status text, notes text, created_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'يجب تسجيل الدخول' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p join public.doctors d on d.profile_id = p.id
    where p.id = v_uid and p.role = 'doctor' and p.approval_status = 'approved' and d.is_active is true
  ) then raise exception 'حساب الطبيب غير معتمد أو غير نشط' using errcode = '42501'; end if;

  return query
  select a.id, s.id, a.rep_profile_id, p.full_name, p.age, r.employer_name,
    r.employer_type, p.governorate, s.visit_date, s.start_time, s.end_time,
    a.visit_at, s.capacity, a.status, a.notes, a.created_at
  from public.rep_appointments a
  join public.rep_visit_slots s on s.id = a.slot_id
  join public.profiles p on p.id = a.rep_profile_id
  join public.rep_accounts r on r.profile_id = a.rep_profile_id
  join public.doctors d on d.id = a.doctor_id
  where d.profile_id = v_uid
  order by s.visit_date desc, s.start_time desc, a.created_at desc;
end;
$function$;

revoke all on function public.doctor_rep_appointment_details_v2() from public, anon;
grant execute on function public.doctor_rep_appointment_details_v2() to authenticated;

create table if not exists public.patient_medical_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 180),
  record_date date not null default (now() at time zone 'Asia/Baghdad')::date,
  file_name text not null,
  file_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  created_at timestamptz not null default now()
);
create index if not exists patient_medical_records_patient_date_idx
  on public.patient_medical_records(patient_id, record_date desc, created_at desc);
alter table public.patient_medical_records enable row level security;
grant select, insert, delete on public.patient_medical_records to authenticated;
revoke update on public.patient_medical_records from authenticated;

drop policy if exists patient_medical_records_read_related on public.patient_medical_records;
create policy patient_medical_records_read_related on public.patient_medical_records
for select to authenticated using (
  patient_id = (select auth.uid())
  or exists (
    select 1 from public.appointments a
    join public.doctors d on d.id = a.doctor_id
    where a.patient_id = patient_medical_records.patient_id
      and d.profile_id = (select auth.uid())
      and a.status in ('pending','approved','confirmed','completed')
  )
  or exists (
    select 1 from public.center_appointments a
    join public.center_doctors d on d.id = a.center_doctor_id and d.center_id = a.center_id
    where a.patient_id = patient_medical_records.patient_id
      and d.profile_id = (select auth.uid())
      and a.status in ('pending','approved','confirmed','completed')
  )
);
drop policy if exists patient_medical_records_insert_own on public.patient_medical_records;
create policy patient_medical_records_insert_own on public.patient_medical_records
for insert to authenticated with check (
  patient_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid())
      and p.role = 'patient' and p.approval_status = 'approved'
  )
);
drop policy if exists patient_medical_records_delete_own on public.patient_medical_records;
create policy patient_medical_records_delete_own on public.patient_medical_records
for delete to authenticated using (patient_id = (select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('patient-medical-records','patient-medical-records',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp'];

drop policy if exists patient_medical_files_read_related on storage.objects;
create policy patient_medical_files_read_related on storage.objects
for select to authenticated using (
  bucket_id = 'patient-medical-records'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.patient_medical_records r
      where r.file_path = storage.objects.name
        and (
          exists (select 1 from public.appointments a join public.doctors d on d.id=a.doctor_id
            where a.patient_id=r.patient_id and d.profile_id=(select auth.uid())
              and a.status in ('pending','approved','confirmed','completed'))
          or exists (select 1 from public.center_appointments a
            join public.center_doctors d on d.id=a.center_doctor_id and d.center_id=a.center_id
            where a.patient_id=r.patient_id and d.profile_id=(select auth.uid())
              and a.status in ('pending','approved','confirmed','completed'))
        )
    )
  )
);
drop policy if exists patient_medical_files_upload_own on storage.objects;
create policy patient_medical_files_upload_own on storage.objects
for insert to authenticated with check (
  bucket_id = 'patient-medical-records'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.profiles p where p.id = (select auth.uid())
    and p.role = 'patient' and p.approval_status = 'approved')
);
drop policy if exists patient_medical_files_delete_own on storage.objects;
create policy patient_medical_files_delete_own on storage.objects
for delete to authenticated using (
  bucket_id = 'patient-medical-records'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
