-- Only a real Auth phone confirmation transition can auto-approve a new phone-only patient.
CREATE OR REPLACE FUNCTION private.v2_approve_verified_patient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.phone_confirmed_at IS NOT NULL OR NEW.phone_confirmed_at IS NULL OR
    coalesce(NEW.email,'')<>'' OR NEW.phone IS DISTINCT FROM OLD.phone OR
    coalesce(NEW.phone,'') !~ '^\+?9647[0-9]{9}$' THEN RETURN NEW; END IF;
 UPDATE public.profiles p SET approval_status='approved'
 WHERE p.id=NEW.id AND p.role='patient' AND p.approval_status='pending'
 AND length(btrim(p.full_name)) BETWEEN 3 AND 120 AND p.age BETWEEN 1 AND 120
 AND p.governorate IN ('بغداد','النجف','كربلاء','بابل','القادسية','المثنى','ذي قار','ميسان','البصرة','واسط','ديالى','صلاح الدين','الأنبار','نينوى','كركوك','أربيل','دهوك','السليمانية','حلبجة')
 AND EXISTS(SELECT 1 FROM private.profile_private_details d WHERE d.profile_id=p.id AND regexp_replace(d.phone,'^\+','')=regexp_replace(NEW.phone,'^\+',''));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_approve_verified_patient() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v2_phone_patient_confirmation AFTER UPDATE OF phone_confirmed_at ON auth.users FOR EACH ROW WHEN (OLD.phone_confirmed_at IS NULL AND NEW.phone_confirmed_at IS NOT NULL) EXECUTE FUNCTION private.v2_approve_verified_patient();
