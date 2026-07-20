-- 1) Promotion columns on stores
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS promotion_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS promotion_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS promotion_approved_by uuid;

-- Validate status values via trigger (no CHECK constraint per project rules)
CREATE OR REPLACE FUNCTION public.validate_store_promotion_status()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.promotion_status NOT IN ('none','requested','active','rejected','expired') THEN
    RAISE EXCEPTION 'Invalid promotion_status: %', NEW.promotion_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_store_promotion_status_trg ON public.stores;
CREATE TRIGGER validate_store_promotion_status_trg
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.validate_store_promotion_status();

-- Protect promotion fields: only admins or the owner (via the RPC) may modify them
CREATE OR REPLACE FUNCTION public.protect_store_promotion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF (OLD.promotion_status IS DISTINCT FROM NEW.promotion_status
      OR OLD.promotion_starts_at IS DISTINCT FROM NEW.promotion_starts_at
      OR OLD.promotion_ends_at IS DISTINCT FROM NEW.promotion_ends_at
      OR OLD.promotion_amount_paid IS DISTINCT FROM NEW.promotion_amount_paid
      OR OLD.promotion_approved_by IS DISTINCT FROM NEW.promotion_approved_by
      OR OLD.promotion_requested_at IS DISTINCT FROM NEW.promotion_requested_at)
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can modify promotion fields directly. Use the dedicated functions.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_store_promotion_trg ON public.stores;
CREATE TRIGGER protect_store_promotion_trg
  BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.protect_store_promotion();

-- 2) Store owner: request a promotion
CREATE OR REPLACE FUNCTION public.request_store_promotion(p_store_id uuid, p_days integer, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
    RAISE EXCEPTION 'Days must be between 1 and 90';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 1000 THEN
    RAISE EXCEPTION 'Amount must be between 0 and 1000';
  END IF;

  SELECT owner_id INTO v_owner FROM stores WHERE id = p_store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Store not found'; END IF;
  IF v_owner <> auth.uid() AND NOT is_support_or_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE stores SET
    promotion_status = 'requested',
    promotion_requested_at = now(),
    promotion_amount_paid = p_amount,
    promotion_starts_at = now(),
    promotion_ends_at = now() + (p_days || ' days')::interval,
    promotion_approved_by = NULL
  WHERE id = p_store_id;
END;
$$;

-- 3) Admin: approve / reject / cancel
CREATE OR REPLACE FUNCTION public.admin_set_store_promotion(
  p_store_id uuid, p_status text, p_days integer DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can manage promotions';
  END IF;
  IF p_status NOT IN ('active','rejected','none','expired') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  IF p_status = 'active' THEN
    UPDATE stores SET
      promotion_status = 'active',
      promotion_starts_at = COALESCE(promotion_starts_at, now()),
      promotion_ends_at = CASE
        WHEN p_days IS NOT NULL THEN now() + (p_days || ' days')::interval
        ELSE COALESCE(promotion_ends_at, now() + interval '7 days')
      END,
      promotion_approved_by = auth.uid()
    WHERE id = p_store_id;
  ELSE
    UPDATE stores SET
      promotion_status = p_status,
      promotion_approved_by = auth.uid()
    WHERE id = p_store_id;
  END IF;

  PERFORM log_admin_action(
    'set_store_promotion', 'store', p_store_id::text,
    'Promotion → ' || p_status,
    jsonb_build_object('status', p_status, 'days', p_days)
  );
END;
$$;