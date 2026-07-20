-- Driver offer events: track acceptance / decline / timeout per offer
CREATE TABLE IF NOT EXISTS public.driver_offer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  action text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Validate action via trigger (avoid CHECK with non-immutable expressions)
CREATE OR REPLACE FUNCTION public.validate_driver_offer_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.action NOT IN ('accepted','declined','timed_out','viewed') THEN
    RAISE EXCEPTION 'Invalid action: %', NEW.action;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_driver_offer_action_trg ON public.driver_offer_events;
CREATE TRIGGER validate_driver_offer_action_trg
  BEFORE INSERT OR UPDATE ON public.driver_offer_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_driver_offer_action();

CREATE INDEX IF NOT EXISTS idx_driver_offer_events_driver ON public.driver_offer_events(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_offer_events_order ON public.driver_offer_events(order_id);

ALTER TABLE public.driver_offer_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers insert own offer events"
  ON public.driver_offer_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Drivers view own offer events"
  ON public.driver_offer_events FOR SELECT
  TO authenticated
  USING (auth.uid() = driver_id);

CREATE POLICY "Support and admins view all offer events"
  ON public.driver_offer_events FOR SELECT
  TO authenticated
  USING (public.is_support_or_admin(auth.uid()));
