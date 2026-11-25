create table if not exists public.patient_login_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_key text not null unique,
  login_email text not null unique,
  created_at timestamptz not null default pg_catalog.now()
);
alter table public.patient_login_accounts enable row level security;
revoke all on table public.patient_login_accounts from public, anon, authenticated;
grant all on table public.patient_login_accounts to service_role;

create table if not exists public.patient_auth_rate_limits (
  bucket_key text primary key,
  window_started timestamptz not null,
  attempts integer not null default 0
);
alter table public.patient_auth_rate_limits enable row level security;
revoke all on table public.patient_auth_rate_limits from public, anon, authenticated;
grant all on table public.patient_auth_rate_limits to service_role;

create or replace function public.consume_balsam_auth_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempts integer;
begin
  if p_key !~ '^[a-f0-9]{64}$' or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;
  insert into public.patient_auth_rate_limits(bucket_key, window_started, attempts)
  values (p_key, pg_catalog.now(), 1)
  on conflict (bucket_key) do update
  set window_started = case
        when public.patient_auth_rate_limits.window_started + pg_catalog.make_interval(secs => p_window_seconds) <= pg_catalog.now()
        then pg_catalog.now()
        else public.patient_auth_rate_limits.window_started
      end,
      attempts = case
        when public.patient_auth_rate_limits.window_started + pg_catalog.make_interval(secs => p_window_seconds) <= pg_catalog.now()
        then 1
        else public.patient_auth_rate_limits.attempts + 1
      end
  returning attempts into v_attempts;
  delete from public.patient_auth_rate_limits
  where window_started < pg_catalog.now() - interval '2 days';
  return v_attempts <= p_limit;
end;
$function$;
revoke all on function public.consume_balsam_auth_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_balsam_auth_rate_limit(text, integer, integer) to service_role;
