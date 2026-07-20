
-- Prevent duplicate reports per order
CREATE UNIQUE INDEX IF NOT EXISTS aade_delivery_reports_order_id_uniq
  ON public.aade_delivery_reports(order_id)
  WHERE order_id IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_net;

-- Trigger function: when order moves to delivered, fire-and-forget the submit function
CREATE OR REPLACE FUNCTION public.trg_aade_autosubmit_on_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF NEW.status::text <> 'delivered' THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = 'delivered' THEN
    RETURN NEW;
  END IF;

  SELECT platform_reporting_enabled INTO v_enabled
  FROM public.aade_platform_config
  LIMIT 1;
  IF COALESCE(v_enabled, false) = false THEN
    RETURN NEW;
  END IF;

  -- Skip if already sent
  IF EXISTS (
    SELECT 1 FROM public.aade_delivery_reports
    WHERE order_id = NEW.id AND status = 'sent'
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://<YOUR_PROJECT>.supabase.co/functions/v1/aade-submit-delivery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<SUPABASE_ANON_OR_SERVICE_JWT>'
    ),
    body := jsonb_build_object('order_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block order updates due to reporting failures
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_aade_autosubmit ON public.orders;
CREATE TRIGGER orders_aade_autosubmit
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_aade_autosubmit_on_delivered();
