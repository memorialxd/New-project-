-- Expose dist_offer_timeout_seconds via public RPC and align default with UI (60s)
ALTER TABLE public.platform_settings
  ALTER COLUMN dist_offer_timeout_seconds SET DEFAULT 60;

UPDATE public.platform_settings
  SET dist_offer_timeout_seconds = 60
  WHERE id = 1 AND dist_offer_timeout_seconds IS NULL;

DROP FUNCTION IF EXISTS public.get_platform_settings_public();

CREATE OR REPLACE FUNCTION public.get_platform_settings_public()
RETURNS TABLE(
  platform_service_fee numeric,
  max_cash_cap numeric,
  show_stores_on_driver_map boolean,
  assignment_mode text,
  maintenance_mode boolean,
  maintenance_message text,
  customer_base_fee numeric,
  customer_per_km_fee numeric,
  max_stacked_orders integer,
  stacking_enabled boolean,
  dist_offer_timeout_seconds integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    platform_service_fee,
    max_cash_cap,
    show_stores_on_driver_map,
    assignment_mode,
    maintenance_mode,
    maintenance_message,
    customer_base_fee,
    customer_per_km_fee,
    max_stacked_orders,
    stacking_enabled,
    dist_offer_timeout_seconds
  FROM public.platform_settings
  WHERE id = 1
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_platform_settings_public() TO anon, authenticated, service_role;