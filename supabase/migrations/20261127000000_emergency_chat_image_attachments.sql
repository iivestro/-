alter table public.emergency_chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_mime text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'emergency-chat-attachments',
  'emergency-chat-attachments',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
