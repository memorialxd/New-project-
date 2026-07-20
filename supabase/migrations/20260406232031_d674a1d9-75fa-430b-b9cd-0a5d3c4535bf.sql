
-- Drop the problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Drivers can update assigned orders" ON public.orders;
DROP POLICY IF EXISTS "Store owners can update store orders" ON public.orders;

-- Recreate without self-referencing subqueries
CREATE POLICY "Drivers can update assigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (auth.uid() = driver_id)
WITH CHECK (auth.uid() = driver_id);

CREATE POLICY "Store owners can update store orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM stores
    WHERE stores.id = orders.store_id AND stores.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM stores
    WHERE stores.id = orders.store_id AND stores.owner_id = auth.uid()
  )
);

-- Use a trigger to protect financial fields instead of self-referencing RLS
CREATE OR REPLACE FUNCTION public.protect_order_financials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Admins can change anything
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Prevent non-admins from modifying financial fields
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.delivery_fee IS DISTINCT FROM OLD.delivery_fee
     OR NEW.tip_amount IS DISTINCT FROM OLD.tip_amount THEN
    RAISE EXCEPTION 'Cannot modify financial fields';
  END IF;

  -- Prevent drivers/stores from changing customer_id or store_id
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'Cannot modify order ownership fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_order_financials_trigger ON public.orders;
CREATE TRIGGER protect_order_financials_trigger
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.protect_order_financials();
