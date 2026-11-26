create or replace function public.home_service_book_location(
  p_provider uuid,
  p_description text,
  p_lat double precision,
  p_lon double precision,
  p_address text,
  p_contact_phone text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_digits text;
  v_phone text;
  v_request_id uuid;
begin
  v_digits := pg_catalog.regexp_replace(coalesce(p_contact_phone, ''), '[^0-9]', '', 'g');
  if pg_catalog.length(v_digits) = 13 and pg_catalog.left(v_digits, 4) = '9647' then
    v_phone := '0' || pg_catalog.substr(v_digits, 4);
  else
    v_phone := v_digits;
  end if;
  if pg_catalog.length(v_phone) <> 11 or pg_catalog.left(v_phone, 2) <> '07' then
    raise exception using errcode = '22023', message = 'أدخل رقم تواصل عراقي صحيحاً يبدأ بـ 07.';
  end if;

  v_request_id := public.home_service_book(p_provider, p_description);

  update public.home_service_requests
  set contact_phone = v_phone
  where id = v_request_id
    and patient_id = (select auth.uid());
  if not found then
    raise exception 'تعذر حفظ رقم التواصل للطلب.';
  end if;

  insert into public.home_service_locations(request_id, latitude, longitude, address)
  values (v_request_id, p_lat, p_lon, nullif(pg_catalog.btrim(coalesce(p_address, '')), ''));

  return v_request_id;
end;
$function$;

revoke all on function public.home_service_book_location(uuid, text, double precision, double precision, text, text) from public, anon;
grant execute on function public.home_service_book_location(uuid, text, double precision, double precision, text, text) to authenticated;

revoke all on function public.home_service_book_location(uuid, text, double precision, double precision, text) from public, anon, authenticated;
