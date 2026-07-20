ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS sla_warn_seconds integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS sla_urgent_seconds integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS sla_breach_seconds integer NOT NULL DEFAULT 600;

-- Allow support role to update SLA settings only (admins already have full access)
CREATE POLICY "Support can update SLA settings"
ON public.platform_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'support'))
WITH CHECK (public.has_role(auth.uid(), 'support'));