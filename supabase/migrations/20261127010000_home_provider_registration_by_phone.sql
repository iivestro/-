alter table public.home_service_providers
  add column if not exists phone text;

create or replace function public.admin_add_home_service_provider_by_phone(
  p_display_name text,
  p_phone text,
  p_governorate text,
  p_kind text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_digits text;
  v_local_phone text;
  v_matches integer;
  v_account_id uuid;
  v_kind text;
  v_gender text;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'غير مصرح لك بإضافة مقدم خدمة.';
  end if;

  if p_display_name is null or pg_catalog.length(pg_catalog.btrim(p_display_name)) < 2
     or pg_catalog.length(pg_catalog.btrim(p_display_name)) > 150 then
    raise exception using errcode = '22023', message = 'أدخل اسماً صحيحاً لمقدم الخدمة.';
  end if;

  if p_governorate is null or pg_catalog.length(pg_catalog.btrim(p_governorate)) < 2
     or pg_catalog.length(pg_catalog.btrim(p_governorate)) > 80 then
    raise exception using errcode = '22023', message = 'أدخل المحافظة بشكل صحيح.';
  end if;

  v_digits := pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if pg_catalog.length(v_digits) = 13 and pg_catalog.left(v_digits, 4) = '9647' then
    v_local_phone := '0' || pg_catalog.substr(v_digits, 4);
  else
    v_local_phone := v_digits;
  end if;
  if pg_catalog.length(v_local_phone) <> 11 or pg_catalog.left(v_local_phone, 2) <> '07' then
    raise exception using errcode = '22023', message = 'أدخل رقم هاتف عراقي يبدأ بـ 07 ويتكون من 11 رقماً.';
  end if;

  if p_kind = 'laboratory' then
    v_kind := 'laboratory';
    v_gender := null;
  elsif p_kind = 'male' then
    v_kind := 'nurse';
    v_gender := 'male';
  elsif p_kind = 'female' then
    v_kind := 'nurse';
    v_gender := 'female';
  else
    raise exception using errcode = '22023', message = 'اختر مختبراً أو ممرضاً أو ممرضة.';
  end if;

  select pg_catalog.count(*) into v_matches
  from public.profiles p
  where pg_catalog.right(pg_catalog.regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10)
        = pg_catalog.right(v_local_phone, 10);

  if v_matches <> 1 then
    raise exception using errcode = 'P0001',
      message = 'لم نعثر على حساب واحد مرتبط بهذا الرقم. تأكد من الرقم أو أنشئ حساب مقدم الخدمة أولاً.';
  end if;

  select p.id into v_account_id
  from public.profiles p
  where pg_catalog.right(pg_catalog.regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10)
        = pg_catalog.right(v_local_phone, 10)
  limit 1;

  insert into public.home_service_providers (
    account_id, kind, gender, display_name, governorate, phone, approved
  ) values (
    v_account_id, v_kind, v_gender, pg_catalog.btrim(p_display_name),
    pg_catalog.btrim(p_governorate), v_local_phone, false
  );

  return v_account_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'هذا الحساب مسجل مسبقاً ضمن مقدمي الخدمات.';
end;
$function$;

revoke all on function public.admin_add_home_service_provider_by_phone(text, text, text, text) from public, anon;
grant execute on function public.admin_add_home_service_provider_by_phone(text, text, text, text) to authenticated;
