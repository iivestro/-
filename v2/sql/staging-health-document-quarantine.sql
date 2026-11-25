-- Draft for private health documents and explicit, revocable sharing.
-- Do not enable until content scanning, client upload, download and lifecycle tests pass.
CREATE TABLE private.v2_health_attachments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES private.v2_personal_health_items(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 object_path text NOT NULL UNIQUE,
 mime_type text NOT NULL CHECK(mime_type IN('application/pdf','image/jpeg','image/png')),
 scan_state text NOT NULL DEFAULT 'pending' CHECK(scan_state IN('pending','clean','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.v2_health_shares(
 attachment_id uuid NOT NULL REFERENCES private.v2_health_attachments(id) ON DELETE CASCADE,
 doctor_profile_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(attachment_id,doctor_profile_id)
);
ALTER TABLE private.v2_health_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.v2_health_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.v2_health_attachments,private.v2_health_shares FROM PUBLIC,anon,authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('patient-private-health','patient-private-health',false,5242880,ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,allowed_mime_types=ARRAY['application/pdf','image/jpeg','image/png'];
-- Keep the bucket inaccessible to client roles until scanning and sharing integration is validated.
CREATE POLICY health_files_no_direct_read ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(bucket_id<>'patient-private-health');
CREATE POLICY health_files_no_direct_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'patient-private-health');
CREATE POLICY health_files_no_direct_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'patient-private-health') WITH CHECK(bucket_id<>'patient-private-health');
CREATE POLICY health_files_no_direct_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'patient-private-health');
CREATE OR REPLACE FUNCTION private.v2_health_doctor_relationship(p_patient uuid,p_doctor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_doctor AND p.role='doctor' AND p.approval_status='approved')
AND (
 EXISTS(SELECT 1 FROM public.appointments b JOIN public.doctors d ON d.id=b.doctor_id WHERE b.patient_id=p_patient AND d.profile_id=p_doctor AND d.is_active AND d.admin_is_active AND d.subscription_expires_at>now() AND b.status IN('approved','completed') AND b.requested_date>=current_date-90)
 OR EXISTS(SELECT 1 FROM public.center_appointments b JOIN public.center_doctors cd ON cd.id=b.center_doctor_id JOIN public.medical_centers c ON c.id=b.center_id AND c.id=cd.center_id WHERE b.patient_id=p_patient AND cd.profile_id=p_doctor AND cd.is_active AND c.is_active AND c.subscription_expires_at>now() AND b.status IN('confirmed','completed') AND b.requested_date>=current_date-90)
);
$$;
REVOKE ALL ON FUNCTION private.v2_health_doctor_relationship(uuid,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.v2_health_document_action(p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); r text; a private.v2_health_attachments%ROWTYPE; aid uuid; item uuid; doctor_id uuid; mime text; ext text; path text; result jsonb;
BEGIN
 IF u IS NULL OR NOT public.v2_session_active() OR NOT EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE enabled) THEN RAISE EXCEPTION 'Unavailable' USING ERRCODE='42501'; END IF;
 SELECT role INTO r FROM public.profiles WHERE id=u AND approval_status='approved';
 IF r IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>4096 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='42501'; END IF;
 IF p_action='reserve' AND r='patient' THEN
 item:=(p_data->>'item_id')::uuid;mime:=p_data->>'mime_type';ext:=CASE mime WHEN 'application/pdf' THEN 'pdf' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' END;
 IF ext IS NULL OR NOT EXISTS(SELECT 1 FROM private.v2_personal_health_items WHERE id=item AND patient_id=u) THEN RAISE EXCEPTION 'Invalid document' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('health-document:'||u::text,0));
 IF (SELECT count(*) FROM private.v2_health_attachments WHERE patient_id=u)>=100 THEN RAISE EXCEPTION 'Document limit' USING ERRCODE='22023'; END IF;
 aid:=gen_random_uuid();path:=u::text||'/'||item::text||'/'||aid::text||'.'||ext;
 INSERT INTO private.v2_health_attachments(id,item_id,patient_id,object_path,mime_type) VALUES(aid,item,u,path,mime);
 RETURN jsonb_build_object('id',aid,'object_path',path,'reserved',true);
 ELSIF p_action='list' AND r='patient' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT id,item_id,mime_type,created_at,scan_state,object_path FROM private.v2_health_attachments WHERE patient_id=u ORDER BY created_at DESC LIMIT 100)x;
 RETURN result;
 ELSIF p_action='shared_list' AND r='doctor' THEN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (SELECT a.id,a.mime_type,a.created_at,s.expires_at,a.object_path FROM private.v2_health_shares s JOIN private.v2_health_attachments a ON a.id=s.attachment_id WHERE a.scan_state='clean' AND s.doctor_profile_id=u AND s.expires_at>now() AND private.v2_health_doctor_relationship(a.patient_id,u) AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='patient-private-health' AND o.name=a.object_path) ORDER BY s.created_at DESC LIMIT 100)x;
 RETURN result;
 END IF;
 aid:=(p_data->>'id')::uuid;
 SELECT * INTO a FROM private.v2_health_attachments WHERE id=aid;
 IF a.id IS NULL THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='42501'; END IF;
 IF p_action='share' AND r='patient' AND a.patient_id=u THEN
 doctor_id:=(p_data->>'doctor_profile_id')::uuid;
 IF a.scan_state<>'clean' OR p_data->>'consent' IS DISTINCT FROM 'true' OR NOT private.v2_health_doctor_relationship(u,doctor_id) OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='patient-private-health' AND o.name=a.object_path) THEN RAISE EXCEPTION 'Consent or document unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO private.v2_health_shares(attachment_id,doctor_profile_id,expires_at) VALUES(aid,doctor_id,now()+interval '7 days') ON CONFLICT(attachment_id,doctor_profile_id) DO UPDATE SET expires_at=excluded.expires_at;
 RETURN jsonb_build_object('shared',true,'expires_in_days',7);
 ELSIF p_action='revoke' AND r='patient' AND a.patient_id=u THEN
 DELETE FROM private.v2_health_shares WHERE attachment_id=aid AND doctor_profile_id=(p_data->>'doctor_profile_id')::uuid;
 RETURN jsonb_build_object('revoked',true);
 ELSIF p_action='authorize_read' AND a.scan_state='clean' AND ((r='patient' AND a.patient_id=u) OR (r='doctor' AND private.v2_health_doctor_relationship(a.patient_id,u) AND EXISTS(SELECT 1 FROM private.v2_health_shares s WHERE s.attachment_id=aid AND s.doctor_profile_id=u AND s.expires_at>now()))) THEN
 -- This authorizes metadata only. No signed URL or storage access is issued yet.
 RETURN jsonb_build_object('authorized',true,'id',aid,'mime_type',a.mime_type,'object_path',a.object_path);
 END IF;
 RAISE EXCEPTION 'Forbidden document action' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.v2_health_document_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_health_document_action(text,jsonb) TO authenticated;

-- Allow uploads only to a reserved owner path. Unscanned content is quarantined.
CREATE OR REPLACE FUNCTION public.v2_health_storage_allowed(p_path text,p_operation text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
SELECT auth.uid() IS NOT NULL AND public.v2_session_active()
 AND EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE enabled)
 AND EXISTS(SELECT 1 FROM private.v2_health_attachments a JOIN public.profiles p ON p.id=auth.uid() AND p.approval_status='approved'
 WHERE a.object_path=p_path AND (
 (p_operation='upload' AND p.role='patient' AND a.patient_id=p.id AND a.scan_state='pending' AND a.created_at>now()-interval '1 hour')
 OR (p_operation='read' AND a.scan_state='clean' AND ((p.role='patient' AND a.patient_id=p.id) OR (p.role='doctor' AND private.v2_health_doctor_relationship(a.patient_id,p.id) AND EXISTS(SELECT 1 FROM private.v2_health_shares s WHERE s.attachment_id=a.id AND s.doctor_profile_id=p.id AND s.expires_at>now()))))
 ));
$$;
REVOKE ALL ON FUNCTION public.v2_health_storage_allowed(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_health_storage_allowed(text,text) TO anon,authenticated;
DROP POLICY health_files_no_direct_read ON storage.objects;
DROP POLICY health_files_no_direct_insert ON storage.objects;
CREATE POLICY health_files_guard_read ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(bucket_id<>'patient-private-health' OR (select public.v2_health_storage_allowed(name,'read')));
CREATE POLICY health_files_guard_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'patient-private-health' OR (select public.v2_health_storage_allowed(name,'upload')));
CREATE POLICY health_files_owner_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='patient-private-health' AND (select public.v2_health_storage_allowed(name,'upload')));
CREATE POLICY health_files_authorized_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='patient-private-health' AND (select public.v2_health_storage_allowed(name,'read')));
-- No updates/upserts or deletes by clients. Scanner worker must verify actual bytes.
CREATE OR REPLACE FUNCTION public.v2_health_scan_result(p_id uuid,p_clean boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private.v2_health_attachments a SET scan_state=CASE WHEN p_clean THEN 'clean' ELSE 'rejected' END
 WHERE a.id=p_id AND a.scan_state='pending' AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='patient-private-health' AND o.name=a.object_path);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.v2_health_scan_result(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_health_scan_result(uuid,boolean) TO service_role;
