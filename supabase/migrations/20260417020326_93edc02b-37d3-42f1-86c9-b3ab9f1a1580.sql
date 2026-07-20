CREATE TABLE public.ticket_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_messages_ticket ON public.ticket_messages(ticket_id, created_at);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers view own ticket messages"
ON public.ticket_messages FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.support_tickets t
  WHERE t.id = ticket_messages.ticket_id AND t.driver_id = auth.uid()
));

CREATE POLICY "Drivers post on own tickets"
ON public.ticket_messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid() AND
  EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_messages.ticket_id AND t.driver_id = auth.uid())
);

CREATE POLICY "Support and admins view all messages"
ON public.ticket_messages FOR SELECT
USING (public.has_role(auth.uid(), 'support'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Support and admins post messages"
ON public.ticket_messages FOR INSERT
WITH CHECK (
  sender_id = auth.uid() AND
  (public.has_role(auth.uid(), 'support'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
);

CREATE POLICY "Support can view all tickets"
ON public.support_tickets FOR SELECT
USING (public.has_role(auth.uid(), 'support'::public.app_role));

CREATE POLICY "Support can update all tickets"
ON public.support_tickets FOR UPDATE
USING (public.has_role(auth.uid(), 'support'::public.app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_messages;
ALTER TABLE public.ticket_messages REPLICA IDENTITY FULL;