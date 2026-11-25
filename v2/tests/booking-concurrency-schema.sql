\set ON_ERROR_STOP on
-- Isolated CI PostgreSQL ONLY. No Supabase connection and no real user data.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,role text NOT NULL,approval_status text NOT NULL);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND approval_status='approved') $$;
CREATE TABLE public.doctors(id uuid PRIMARY KEY,profile_id uuid NOT NULL REFERENCES profiles(id),is_active boolean NOT NULL,admin_is_active boolean NOT NULL,subscription_expires_at timestamptz);
CREATE TABLE public.medical_centers(id uuid PRIMARY KEY,profile_id uuid NOT NULL REFERENCES profiles(id),is_active boolean NOT NULL,subscription_expires_at timestamptz);
CREATE TABLE public.center_doctors(id uuid PRIMARY KEY,center_id uuid REFERENCES medical_centers(id),profile_id uuid REFERENCES profiles(id),is_active boolean NOT NULL);
CREATE TABLE public.doctor_schedules(doctor_id uuid REFERENCES doctors(id),day_of_week smallint,start_time time,end_time time,is_available boolean,unlimited_daily boolean,max_daily_patients integer);
CREATE TABLE public.center_doctor_schedules(center_doctor_id uuid REFERENCES center_doctors(id),day_of_week smallint,start_time time,end_time time,is_available boolean,unlimited_daily boolean,max_daily_patients integer);
CREATE TABLE public.appointments(id uuid PRIMARY KEY,patient_id uuid NOT NULL REFERENCES profiles(id),doctor_id uuid NOT NULL REFERENCES doctors(id),requested_date date,appointment_at timestamptz,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),notes text);
CREATE TABLE public.center_appointments(id uuid PRIMARY KEY,patient_id uuid NOT NULL REFERENCES profiles(id),center_id uuid NOT NULL REFERENCES medical_centers(id),center_doctor_id uuid NOT NULL REFERENCES center_doctors(id),requested_date date,appointment_at timestamptz,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),notes text);
-- These are 500,000 synthetic profile rows, not authenticated accounts.
INSERT INTO profiles SELECT md5('synthetic-patient-'||i)::uuid,'patient','approved' FROM generate_series(1,500000) i;
INSERT INTO profiles VALUES ('10000000-0000-4000-8000-000000000001','doctor','approved'),('10000000-0000-4000-8000-000000000002','medical_center','approved'),('10000000-0000-4000-8000-000000000003','doctor','approved');
INSERT INTO doctors VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true,true,now()+interval '30 days');
INSERT INTO medical_centers VALUES ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',true,now()+interval '30 days');
INSERT INTO center_doctors VALUES ('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',true);
INSERT INTO doctor_schedules SELECT '20000000-0000-4000-8000-000000000001',extract(dow from (now() AT TIME ZONE 'Asia/Baghdad')::date+n)::smallint,'09:00','12:00',true,n=2,CASE WHEN n=1 THEN 5 END FROM generate_series(1,2) n;
INSERT INTO center_doctor_schedules SELECT '20000000-0000-4000-8000-000000000003',extract(dow from (now() AT TIME ZONE 'Asia/Baghdad')::date+n)::smallint,'09:00','12:00',true,n=2,CASE WHEN n=1 THEN 5 END FROM generate_series(1,2) n;
ANALYZE profiles;
SELECT count(*) AS synthetic_patient_profiles FROM profiles WHERE role='patient';
EXPLAIN (ANALYZE,BUFFERS) SELECT role,approval_status FROM profiles WHERE id=md5('synthetic-patient-250000')::uuid;
-- No RLS/Auth service emulation: this fixture tests DB constraints and trigger concurrency only.
