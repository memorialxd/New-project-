-- Add per-store sequential order number (1..9999, wraps) so each store has its own ID series
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS store_order_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_orders_store_order_number ON public.orders(store_id, store_order_number);

CREATE OR REPLACE FUNCTION public.assign_store_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_num INTEGER;
BEGIN
  IF NEW.store_order_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.store_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(store_order_number), 0)
    INTO last_num
  FROM public.orders
  WHERE store_id = NEW.store_id;

  NEW.store_order_number := (last_num % 9999) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_store_order_number ON public.orders;
CREATE TRIGGER trg_assign_store_order_number
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.assign_store_order_number();

-- Backfill existing orders per store in created_at order
WITH ranked AS (
  SELECT id, ((ROW_NUMBER() OVER (PARTITION BY store_id ORDER BY created_at) - 1) % 9999) + 1 AS rn
  FROM public.orders
  WHERE store_order_number IS NULL AND store_id IS NOT NULL
)
UPDATE public.orders o SET store_order_number = ranked.rn
FROM ranked WHERE ranked.id = o.id;