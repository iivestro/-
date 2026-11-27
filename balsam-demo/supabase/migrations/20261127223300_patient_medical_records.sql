-- Private medical reports for the isolated staging application.
BEGIN;
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
COMMIT;
