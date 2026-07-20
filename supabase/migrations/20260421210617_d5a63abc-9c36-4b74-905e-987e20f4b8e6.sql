-- Channels table
CREATE TABLE public.support_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL DEFAULT 'channel', -- 'channel' | 'dm'
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_channels ENABLE ROW LEVEL SECURITY;

-- Members
CREATE TABLE public.support_channel_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.support_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, user_id)
);

ALTER TABLE public.support_channel_members ENABLE ROW LEVEL SECURITY;

-- Messages
CREATE TABLE public.support_team_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.support_channels(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL DEFAULT 'support',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_team_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_team_messages_channel_created ON public.support_team_messages(channel_id, created_at DESC);
CREATE INDEX idx_channel_members_user ON public.support_channel_members(user_id);

-- Helper: is the caller part of the support team?
CREATE OR REPLACE FUNCTION public.is_support_or_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'support'::app_role) OR public.has_role(_user_id, 'admin'::app_role);
$$;

-- RLS: support_channels
CREATE POLICY "Support team can view channels"
ON public.support_channels FOR SELECT
USING (public.is_support_or_admin(auth.uid()));

CREATE POLICY "Support team can create channels"
ON public.support_channels FOR INSERT
WITH CHECK (public.is_support_or_admin(auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Admins can update channels"
ON public.support_channels FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete channels"
ON public.support_channels FOR DELETE
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- RLS: support_channel_members
CREATE POLICY "Support team can view members"
ON public.support_channel_members FOR SELECT
USING (public.is_support_or_admin(auth.uid()));

CREATE POLICY "Support team can join channels"
ON public.support_channel_members FOR INSERT
WITH CHECK (public.is_support_or_admin(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "Members can update own membership"
ON public.support_channel_members FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Members can leave"
ON public.support_channel_members FOR DELETE
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

-- RLS: support_team_messages
CREATE POLICY "Support team can read messages"
ON public.support_team_messages FOR SELECT
USING (public.is_support_or_admin(auth.uid()));

CREATE POLICY "Support team can post messages"
ON public.support_team_messages FOR INSERT
WITH CHECK (public.is_support_or_admin(auth.uid()) AND sender_id = auth.uid());

-- Seed default channels
INSERT INTO public.support_channels (name, description, type) VALUES
  ('general', 'Γενική συζήτηση ομάδας υποστήριξης', 'channel'),
  ('escalations', 'Κλιμακούμενα tickets και επείγοντα θέματα', 'channel'),
  ('announcements', 'Ανακοινώσεις διαχείρισης', 'channel');

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_team_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_channels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.support_channel_members;

ALTER TABLE public.support_team_messages REPLICA IDENTITY FULL;
ALTER TABLE public.support_channels REPLICA IDENTITY FULL;
ALTER TABLE public.support_channel_members REPLICA IDENTITY FULL;