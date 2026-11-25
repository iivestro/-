CREATE OR REPLACE FUNCTION public.v2_health_scan_pending()
RETURNS TABLE(id uuid,object_path text,mime_type text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id,a.object_path,a.mime_type FROM private.v2_health_attachments a
 WHERE a.scan_state='pending' AND EXISTS(SELECT 1 FROM private.v2_feature_settings WHERE enabled)
 AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='patient-private-health' AND o.name=a.object_path)
 ORDER BY a.created_at LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.v2_health_scan_pending() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2_health_scan_pending() TO service_role;
