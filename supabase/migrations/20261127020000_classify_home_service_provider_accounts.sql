alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['patient','doctor','admin','representative','emergency_doctor','medical_center','home_service_provider']::text[]));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_account_type text := coalesce(new.raw_user_meta_data ->> 'account_type', '');
  v_is_rep boolean := v_account_type = 'representative';
  v_is_home_provider boolean := v_account_type = 'home_service_provider';
  v_full_name text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), '');
  v_employer_type text := coalesce(new.raw_user_meta_data ->> 'employer_type', '');
  v_employer_name text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'employer_name'), ''), '');
  v_phone text := coalesce(nullif(btrim(new.phone), ''), nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''));
  v_governorate text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'governorate'), ''), '');
begin
  if v_is_rep then
    if v_full_name = ''
       or pg_catalog.array_length(pg_catalog.regexp_split_to_array(v_full_name, '[[:space:]]+'), 1) < 3 then
      raise exception 'يرجى إدخال الاسم الثلاثي للمندوب';
    end if;

    if v_employer_type not in ('scientific_office','company')
       or pg_catalog.length(v_employer_name) < 2
       or pg_catalog.length(v_employer_name) > 180 then
      raise exception 'بيانات جهة العمل غير صحيحة';
    end if;

    if v_phone is null or v_governorate = '' then
      raise exception 'رقم الهاتف والمحافظة مطلوبان';
    end if;
  end if;

  if v_is_home_provider and (v_full_name = '' or v_phone is null or v_governorate = '') then
    raise exception 'الاسم ورقم الهاتف والمحافظة مطلوبة لمقدم الخدمة';
  end if;

  insert into public.profiles (
    id, full_name, phone, age, governorate, role, approval_status
  )
  values (
    new.id,
    v_full_name,
    v_phone,
    nullif(new.raw_user_meta_data ->> 'age', '')::integer,
    nullif(new.raw_user_meta_data ->> 'governorate', ''),
    case
      when v_is_rep then 'representative'
      when v_is_home_provider then 'home_service_provider'
      else 'patient'
    end,
    case
      when v_is_home_provider then 'pending'
      when not v_is_rep
       and v_full_name <> ''
       and coalesce(nullif(new.raw_user_meta_data ->> 'age', '')::integer, 0) between 1 and 120
       and v_governorate in ('بغداد','نينوى','البصرة','النجف','كربلاء','بابل','القادسية','المثنى','ذي قار','ميسان','واسط','ديالى','صلاح الدين','كركوك','الأنبار','أربيل','السليمانية','دهوك','حلبجة')
      then 'approved'
      else 'pending'
    end
  )
  on conflict (id) do nothing;

  if v_is_rep then
    insert into public.rep_accounts(profile_id, employer_type, employer_name, status)
    values (new.id, v_employer_type, v_employer_name, 'pending')
    on conflict (profile_id) do nothing;
  end if;

  return new;
end;
$function$;
