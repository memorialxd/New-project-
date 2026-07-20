
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS auto_balance_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS basket_target_balance numeric NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS basket_max_surcharge_pct numeric NOT NULL DEFAULT 5;

CREATE OR REPLACE FUNCTION public.compute_order_split(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders%ROWTYPE;
  s public.stores%ROWTYPE;
  ps public.platform_settings%ROWTYPE;
  food_subtotal numeric;
  base_total_comm_pct numeric;
  total_comm_pct numeric;
  admin_pct numeric;
  pool_pct numeric;
  pool_pct_floor numeric;
  store_extra_pct numeric;
  delivery_fee numeric;
  store_pays_delivery boolean;
  basket_balance numeric;
  surcharge_pct numeric := 0;
  deficit_ratio numeric := 0;
  res jsonb;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF o.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.stores WHERE id = o.store_id;
  SELECT * INTO ps FROM public.platform_settings WHERE id = 1;

  delivery_fee := COALESCE(o.delivery_fee, 0);
  food_subtotal := GREATEST(COALESCE(o.total_amount, 0) - delivery_fee - COALESCE(o.tip_amount, 0), 0);

  base_total_comm_pct := GREATEST(COALESCE(s.commission_pct, ps.default_commission_pct, 15), 15);
  admin_pct      := GREATEST(COALESCE(ps.admin_share_pct, 5), 5);
  pool_pct_floor := GREATEST(COALESCE(ps.driver_pool_pct_of_subtotal, 10), 10);
  pool_pct       := pool_pct_floor;
  total_comm_pct := base_total_comm_pct;

  -- Smart auto-balance: when basket is below target, raise commission charged to store
  -- and route the surcharge entirely into the driver basket. Capped by basket_max_surcharge_pct.
  IF COALESCE(ps.auto_balance_enabled, true) THEN
    SELECT COALESCE(platform_pool, 0) INTO basket_balance FROM public.admin_treasury WHERE id = 1;
    IF basket_balance < COALESCE(ps.basket_target_balance, 500) AND COALESCE(ps.basket_target_balance,0) > 0 THEN
      deficit_ratio := LEAST(1.0, (ps.basket_target_balance - basket_balance) / ps.basket_target_balance);
      surcharge_pct := round(deficit_ratio * COALESCE(ps.basket_max_surcharge_pct, 0), 2);
      pool_pct       := pool_pct + surcharge_pct;
      total_comm_pct := total_comm_pct + surcharge_pct;
    END IF;
  END IF;

  store_extra_pct := GREATEST(total_comm_pct - admin_pct - pool_pct, 0);
  store_pays_delivery := COALESCE(s.covers_delivery_fee, false);

  res := jsonb_build_object(
    'food_subtotal', food_subtotal,
    'delivery_fee', delivery_fee,
    'tip_amount', COALESCE(o.tip_amount, 0),
    'total_commission_pct', total_comm_pct,
    'admin_pct', admin_pct,
    'driver_pool_pct', pool_pct,
    'driver_pool_pct_floor', pool_pct_floor,
    'auto_balance_surcharge_pct', surcharge_pct,
    'store_extra_commission_pct', store_extra_pct,
    'admin_amount', round(food_subtotal * admin_pct / 100, 2),
    'driver_pool_amount', round(food_subtotal * pool_pct / 100, 2),
    'store_extra_commission', round(food_subtotal * store_extra_pct / 100, 2),
    'store_keeps', round(food_subtotal * (100 - total_comm_pct) / 100, 2),
    'store_pays_delivery', store_pays_delivery,
    'driver_delivery_fee', delivery_fee,
    'driver_tip', COALESCE(o.tip_amount, 0)
  );
  RETURN res;
END;
$function$;
