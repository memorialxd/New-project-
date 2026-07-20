-- Storage bucket for chat attachments (images / gifs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS — bucket is public-read; only authenticated can upload to their own folder
DO $$ BEGIN
  CREATE POLICY "Chat attachments public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users upload chat attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND auth.uid() IS NOT NULL
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own chat attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Attachment columns on chat tables
ALTER TABLE public.ticket_messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text; -- 'image' | 'gif'

ALTER TABLE public.support_team_messages
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text;

-- Allow empty message text when an attachment is present
ALTER TABLE public.ticket_messages ALTER COLUMN message DROP NOT NULL;
ALTER TABLE public.support_team_messages ALTER COLUMN message DROP NOT NULL;