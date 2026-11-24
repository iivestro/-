-- Backfill historical independent-doctor appointment dates and enforce valid daily capacity settings.
-- The appointment trigger is temporarily disabled only inside this atomic migration so legacy rows can be backfilled.

alter table public.appointments disable trigger trg_guard_appointments;

update public.appointments
set requested_date = (appointment_at at time zone 'Asia/Baghdad')::date
where requested_date is null and appointment_at is not null;

alter table public.appointments enable trigger trg_guard_appointments;

do $constraints$
begin
 if not exists(select 1 from pg_constraint where conname='doctor_schedules_daily_capacity_check') then
  alter table public.doctor_schedules add constraint doctor_schedules_daily_capacity_check
   check (unlimited_daily is true or (max_daily_patients is not null and max_daily_patients>0));
 end if;
 if not exists(select 1 from pg_constraint where conname='center_doctor_schedules_daily_capacity_check') then
  alter table public.center_doctor_schedules add constraint center_doctor_schedules_daily_capacity_check
   check (unlimited_daily is true or (max_daily_patients is not null and max_daily_patients>0));
 end if;
end
$constraints$;
