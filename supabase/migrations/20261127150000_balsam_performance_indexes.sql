-- Add indexes for the uncovered foreign keys reported by Supabase's Performance Advisor.
create index if not exists v2_reminder_ledger_recipient_idx
  on private.v2_reminder_ledger (recipient);

create index if not exists v2_support_tickets_replied_by_idx
  on private.v2_support_tickets (replied_by);

create index if not exists rep_subscription_payments_profile_id_idx
  on public.rep_subscription_payments (profile_id);

create index if not exists rep_subscription_payments_recorded_by_idx
  on public.rep_subscription_payments (recorded_by);

-- Evaluate the session uid once per statement instead of once per candidate row.
drop policy if exists approved_patients_create_appointments on public.appointments;

create policy approved_patients_create_appointments
on public.appointments
for insert
to authenticated
with check (
  patient_id = (select auth.uid())
  and status = 'pending'
  and is_approved_user()
  and (
    (
      appointment_at is null
      and requested_date is not null
      and requested_date >= ((now() at time zone 'Asia/Baghdad')::date)
    )
    or
    (
      appointment_at is not null
      and appointment_at > now()
      and (requested_date is null or requested_date = (appointment_at at time zone 'Asia/Baghdad')::date)
    )
  )
  and exists (
    select 1
    from public.doctors d
    join public.profiles p on p.id = d.profile_id
    where d.id = appointments.doctor_id
      and d.is_active is true
      and p.role = 'doctor'
      and p.approval_status = 'approved'
  )
);
