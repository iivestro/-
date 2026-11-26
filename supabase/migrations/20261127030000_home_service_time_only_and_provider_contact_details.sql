alter table public.home_service_requests
  add column if not exists arrival_time time without time zone,
  add column if not exists contact_phone text;

drop function if exists public.home_service_progress(uuid, text, integer, timestamp with time zone);
create function public.home_service_progress(
  p_request uuid,
  p_status text,
  p_price integer default null,
  p_time time without time zone default null
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.home_service_requests r
  set status = p_status,
      quoted_price = case when p_status = 'quoted' then p_price else r.quoted_price end,
      arrival_time = case when p_status = 'quoted' then p_time else r.arrival_time end,
      scheduled_at = case when p_status = 'quoted' then null else r.scheduled_at end
  where r.id = p_request
    and exists (
      select 1 from public.home_service_providers p
      where p.id = r.provider_id
        and p.account_id = (select auth.uid())
        and p.approved
        and (r.status <> 'pending' or p.subscription_expires_at > pg_catalog.now())
    )
    and (
      (r.status = 'pending' and p_status = 'quoted' and p_price >= 0 and p_time is not null)
      or (r.status = 'confirmed' and p_status = 'en_route')
      or (r.status = 'en_route' and p_status = 'arrived')
      or (r.status = 'arrived' and p_status = 'completed')
    );

  if not found then
    raise exception 'Invalid transition';
  end if;
end;
$function$;

revoke all on function public.home_service_progress(uuid, text, integer, time without time zone) from public, anon;
grant execute on function public.home_service_progress(uuid, text, integer, time without time zone) to authenticated;

create or replace function public.home_service_provider_requests()
returns table(
  id uuid,
  description text,
  status text,
  quoted_price integer,
  arrival_time time without time zone,
  patient_name text,
  patient_phone text,
  visit_address text,
  latitude double precision,
  longitude double precision,
  created_at timestamp with time zone
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    r.id,
    r.description,
    r.status,
    r.quoted_price,
    coalesce(r.arrival_time, pg_catalog.timezone('Asia/Baghdad', r.scheduled_at)::time),
    coalesce(nullif(pg_catalog.btrim(patient.full_name), ''), 'المراجع'),
    coalesce(nullif(pg_catalog.btrim(r.contact_phone), ''), nullif(pg_catalog.btrim(patient.phone), '')),
    location.address,
    location.latitude,
    location.longitude,
    r.created_at
  from public.home_service_requests r
  join public.home_service_providers provider on provider.id = r.provider_id
  left join public.profiles patient on patient.id = r.patient_id
  left join public.home_service_locations location on location.request_id = r.id
  where provider.account_id = (select auth.uid())
    and provider.approved
  order by r.created_at desc;
$function$;

revoke all on function public.home_service_provider_requests() from public, anon;
grant execute on function public.home_service_provider_requests() to authenticated;

create or replace function public.home_service_accept(p_request uuid, p_lat double precision, p_lon double precision)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.home_service_requests r
  set status = 'confirmed'
  where r.id = p_request
    and r.patient_id = (select auth.uid())
    and r.status = 'quoted'
    and coalesce(r.arrival_time, pg_catalog.timezone('Asia/Baghdad', r.scheduled_at)::time) is not null;
  if not found then
    raise exception 'Request unavailable';
  end if;

  insert into public.home_service_locations(request_id, latitude, longitude)
  values (p_request, p_lat, p_lon);
end;
$function$;

create or replace function public.home_service_accept_saved(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.home_service_requests r
  set status = 'confirmed'
  where r.id = p_request
    and r.patient_id = (select auth.uid())
    and r.status = 'quoted'
    and coalesce(r.arrival_time, pg_catalog.timezone('Asia/Baghdad', r.scheduled_at)::time) is not null
    and exists (
      select 1 from public.home_service_locations location
      where location.request_id = r.id
    );
  if not found then
    raise exception 'Request unavailable';
  end if;
end;
$function$;
