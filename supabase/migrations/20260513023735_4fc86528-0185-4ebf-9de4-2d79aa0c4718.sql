
CREATE OR REPLACE FUNCTION public.log_surge_override_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.surge_events(zone_id, multiplier, source, reason, ends_at, created_by)
    VALUES (NEW.zone_id, NEW.multiplier, 'manual', NEW.reason, NEW.expires_at, NEW.created_by);

    INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
    VALUES (
      COALESCE(NEW.created_by, auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'surge_override_created',
      'surge_override', NEW.id::text,
      'Manual surge override ×' || NEW.multiplier::text,
      jsonb_build_object('zone_id', NEW.zone_id, 'multiplier', NEW.multiplier, 'expires_at', NEW.expires_at, 'reason', NEW.reason)
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
    VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'surge_override_cancelled',
      'surge_override', OLD.id::text,
      'Cancelled surge override ×' || OLD.multiplier::text,
      jsonb_build_object('zone_id', OLD.zone_id, 'multiplier', OLD.multiplier)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_surge_override_audit ON public.surge_overrides;
CREATE TRIGGER trg_surge_override_audit
AFTER INSERT OR DELETE ON public.surge_overrides
FOR EACH ROW EXECUTE FUNCTION public.log_surge_override_change();
