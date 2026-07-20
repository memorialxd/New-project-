-- Add priority to support tickets
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

-- Constrain to known values via trigger (avoid CHECK for flexibility)
CREATE OR REPLACE FUNCTION public.validate_ticket_priority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.priority NOT IN ('low','normal','high','sos') THEN
    RAISE EXCEPTION 'Invalid priority: %', NEW.priority;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_ticket_priority ON public.support_tickets;
CREATE TRIGGER trg_validate_ticket_priority
BEFORE INSERT OR UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.validate_ticket_priority();

-- Add agent-load scaling settings to platform_settings
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS sla_agent_scaling boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sla_tickets_per_agent integer NOT NULL DEFAULT 5;

-- Helper function: count online support agents (proxy: all users with support role)
CREATE OR REPLACE FUNCTION public.count_active_support_agents()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.user_roles WHERE role = 'support';
$$;

-- Allow support to view agent count
GRANT EXECUTE ON FUNCTION public.count_active_support_agents() TO authenticated;