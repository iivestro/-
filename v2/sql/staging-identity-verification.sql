-- Closed rollout gates; no production use.
CREATE TABLE private.v2_identity_settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),phone_enabled boolean NOT NULL DEFAULT false,email_enabled boolean NOT NULL DEFAULT false);
INSERT INTO private.v2_identity_settings(singleton) VALUES(true);
CREATE TABLE private.v2_email_proof(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,email text NOT NULL,verified_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE private.v2_identity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.v2_email_proof ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.v2_identity_settings,private.v2_email_proof FROM PUBLIC,anon,authenticated;
-- Only a real Auth phone confirmation transition can auto-approve a new phone-only patient.
CREATE OR REPLACE FUNCTION private.v2_approve_verified_patient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.v2_identity_settings WHERE phone_enabled) OR OLD.phone_confirmed_at IS NOT NULL OR NEW.phone_confirmed_at IS NULL OR
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

CREATE OR REPLACE FUNCTION private.v2_phone_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.role='patient' AND NEW.approval_status='approved' AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=NEW.id AND coalesce(u.email,'')='' AND (u.phone_confirmed_at IS NULL OR coalesce(u.phone,'') !~ '^\+?9647[0-9]{9}$')) THEN RAISE EXCEPTION 'Phone verification required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.v2_phone_approval_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER v2_phone_approval_guard BEFORE INSERT OR UPDATE OF role,approval_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.v2_phone_approval_guard();
CREATE OR REPLACE FUNCTION public.v2_record_email_proof()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); sid uuid; verified_email text;
BEGIN
 IF u IS NULL OR NOT public.v2_session_active() OR NOT EXISTS(SELECT 1 FROM private.v2_identity_settings WHERE email_enabled) THEN RETURN false; END IF;
 sid:=(auth.jwt()->>'session_id')::uuid;
 SELECT lower(a.email) INTO verified_email FROM auth.users a JOIN public.profiles p ON p.id=a.id
 WHERE a.id=u AND p.role IN('admin','doctor','medical_center','representative','emergency_doctor','staff') AND p.approval_status IN('pending','approved') AND coalesce(a.email,'')<>'' AND a.email_confirmed_at IS NOT NULL AND coalesce(a.phone,'')=''
 AND EXISTS(SELECT 1 FROM auth.mfa_amr_claims m WHERE m.session_id=sid AND m.authentication_method='otp' AND m.created_at>now()-interval '10 minutes');
 IF verified_email IS NULL THEN RETURN false; END IF;
 INSERT INTO private.v2_email_proof(user_id,email) VALUES(u,verified_email) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=now();
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.v2_identity_verified()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT auth.uid() IS NOT NULL AND public.v2_session_active() AND EXISTS(
 SELECT 1 FROM public.profiles p JOIN auth.users a ON a.id=p.id CROSS JOIN private.v2_identity_settings s
 WHERE p.id=auth.uid() AND (CASE WHEN p.role='patient' THEN NOT s.phone_enabled OR (a.phone_confirmed_at IS NOT NULL AND coalesce(a.phone,'')~'^\+?9647[0-9]{9}$')
 ELSE NOT s.email_enabled OR (a.email_confirmed_at IS NOT NULL AND EXISTS(SELECT 1 FROM private.v2_email_proof v WHERE v.user_id=p.id AND v.email=lower(a.email))) END));
$$;
REVOKE ALL ON FUNCTION public.v2_record_email_proof(),public.v2_identity_verified() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_record_email_proof(),public.v2_identity_verified() TO authenticated;
