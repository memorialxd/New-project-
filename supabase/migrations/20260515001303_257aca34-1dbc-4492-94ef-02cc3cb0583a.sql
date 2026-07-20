CREATE OR REPLACE FUNCTION public.auto_create_earning_on_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_settings platform_settings%ROWTYPE;
  v_override store_pricing_overrides%ROWTYPE;
  v_base numeric; v_per_km numeric; v_min numeric;
  v_km numeric; v_tip numeric; v_total_base numeric;
  v_vehicle_type text;
  v_vehicle_mult numeric := 1.0;
  v_peak_mult numeric := 1.0;
  v_dow integer; v_hour integer;
BEGIN
  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' OR NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM earnings WHERE order_id = NEW.id AND driver_id = NEW.driver_id) THEN
    RETURN NEW;
  END IF;

  v_tip := COALESCE(NEW.tip_amount, 0);

  -- Prefer the payout the driver actually accepted (driver_payout locked at order time).
  -- Fall back to formula only when payout wasn't set.
  IF COALESCE(NEW.driver_payout, 0) > 0 THEN
    v_total_base := NEW.driver_payout;
  ELSE
    SELECT * INTO v_settings FROM platform_settings WHERE id = 1;
    SELECT * INTO v_override FROM store_pricing_overrides WHERE store_id = NEW.store_id;

    v_base   := COALESCE(v_override.base_pay,    v_settings.base_pay,    3);
    v_per_km := COALESCE(v_override.per_km_rate, v_settings.per_km_rate, 0.5);
    v_min    := COALESCE(v_override.min_pay,     v_settings.min_pay,     3);
    v_km     := COALESCE(NEW.distance_km, 0);

    SELECT vehicle_type INTO v_vehicle_type FROM driver_profiles WHERE user_id = NEW.driver_id;
    IF v_vehicle_type = 'bike' THEN
      v_vehicle_mult := COALESCE(v_settings.bike_multiplier, 1.0);
    ELSIF v_vehicle_type = 'car' THEN
      v_vehicle_mult := COALESCE(v_settings.car_multiplier, 1.0);
    ELSE
      v_vehicle_mult := COALESCE(v_settings.motorcycle_multiplier, 1.0);
    END IF;

    v_dow  := EXTRACT(ISODOW FROM now())::int;
    v_hour := EXTRACT(HOUR   FROM now())::int;
    IF v_dow = ANY(COALESCE(v_settings.peak_weekdays, ARRAY[1,2,3,4,5,6,7]))
       AND v_hour >= COALESCE(v_settings.peak_start_hour, 19)
       AND v_hour <  COALESCE(v_settings.peak_end_hour, 22) THEN
      v_peak_mult := COALESCE(v_settings.peak_multiplier, 1.0);
    END IF;

    v_total_base := GREATEST(v_min, v_base + v_per_km * v_km) * v_vehicle_mult * v_peak_mult;
  END IF;

  INSERT INTO earnings (driver_id, order_id, base_pay, tip, bonus)
  VALUES (NEW.driver_id, NEW.id, v_total_base, v_tip, 0);

  RETURN NEW;
END;
$$;

-- Backfill: any existing earnings rows where base_pay differs from the locked driver_payout get realigned.
UPDATE public.earnings e
SET base_pay = o.driver_payout
FROM public.orders o
WHERE e.order_id = o.id
  AND COALESCE(o.driver_payout, 0) > 0
  AND e.base_pay <> o.driver_payout;