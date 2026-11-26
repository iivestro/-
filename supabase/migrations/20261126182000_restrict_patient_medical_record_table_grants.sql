revoke all privileges on table public.patient_medical_records from public, anon;
grant select, insert, delete on table public.patient_medical_records to authenticated;
revoke update, truncate, references, trigger on table public.patient_medical_records from authenticated;
