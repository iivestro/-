drop function if exists public.home_service_progress(uuid, text, integer, time without time zone);

create or replace function public.home_service_progress(
  p_request uuid,
  p_status text,
  p_price integer default null,
  p_time text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_arrival_time time without time zone;
  v_time_text text := nullif(pg_catalog.btrim(p_time), '');
begin
  if p_status = 'quoted' then
    if v_time_text is null or pg_catalog.length(v_time_text) > 64 then
      raise exception using errcode = '22007', message = 'أدخل وقت الوصول بشكل صحيح.';
    end if;

    if v_time_text ~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]+)?)?$' then
      v_arrival_time := v_time_text::time without time zone;
    elsif v_time_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' then
      begin
        v_arrival_time := pg_catalog.timezone(
          'Asia/Baghdad',
          v_time_text::timestamp with time zone
        )::time without time zone;
      exception when others then
        raise exception using errcode = '22007', message = 'أدخل وقت وصول صالحاً.';
      end;
    else
      raise exception using errcode = '22007', message = 'أدخل وقت الوصول فقط، مثل 14:30.';
    end if;
  end if;

  update public.home_service_requests r
  set status = p_status,
      quoted_price = case when p_status = 'quoted' then p_price else r.quoted_price end,
      arrival_time = case when p_status = 'quoted' then v_arrival_time else r.arrival_time end,
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
      (r.status = 'pending' and p_status = 'quoted' and p_price >= 0 and v_arrival_time is not null)
      or (r.status = 'confirmed' and p_status = 'en_route')
      or (r.status = 'en_route' and p_status = 'arrived')
      or (r.status = 'arrived' and p_status = 'completed')
    );

  if not found then
    raise exception 'Invalid transition';
  end if;
end;
$function$;

revoke all on function public.home_service_progress(uuid, text, integer, text) from public, anon;
grant execute on function public.home_service_progress(uuid, text, integer, text) to authenticated;

notify pgrst, 'reload schema';
