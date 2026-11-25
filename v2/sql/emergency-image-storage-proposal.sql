-- Proposal only: review and test before enabling any emergency traffic.
ALTER TABLE public.emergency_chat_messages ADD COLUMN IF NOT EXISTS attachment_path text;
ALTER TABLE public.emergency_chat_messages ADD CONSTRAINT emergency_attachment_path_bound
 CHECK (attachment_path IS NULL OR attachment_path ~ ('^'||chat_id::text||'/[0-9a-f-]{36}\.jpg$'));
ALTER TABLE public.emergency_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_chats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.emergency_chat_messages,public.emergency_chats FROM PUBLIC,anon,authenticated;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('emergency-private-images','emergency-private-images',false,1048576,ARRAY['image/jpeg'])
 ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=1048576,allowed_mime_types=ARRAY['image/jpeg'];
-- Restrictive policies override other permissive policies for this bucket.
CREATE POLICY emergency_images_block_client_select ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(bucket_id<>'emergency-private-images');
CREATE POLICY emergency_images_block_client_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'emergency-private-images');
CREATE POLICY emergency_images_block_client_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'emergency-private-images') WITH CHECK(bucket_id<>'emergency-private-images');
CREATE POLICY emergency_images_block_client_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'emergency-private-images');
