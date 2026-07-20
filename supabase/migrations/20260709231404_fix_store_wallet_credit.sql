/*
# Fix: Store wallets not credited on order delivery

## Problem
The settle_order_commission trigger computes store_keeps_amt and writes it
to NEW.store_charge, but never credits the store_wallets table or logs to
store_wallet_ledger. Stores see €0 balance.

## Fix
Add a separate AFTER UPDATE trigger that credits the store wallet when an
order transitions to 'delivered'. It reads NEW.store_charge (which
settle_order_commission already computed) and credits it to the store wallet.
Idempotent: guarded by WHERE NOT EXISTS on store_wallet_ledger.

Also backfills all previously delivered orders.
*/

CREATE OR REPLACE FUNCTION public.credit_store_wallet_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_amount numeric;
BEGIN
  IF NEW.status::text <> 'delivered' THEN RETURN NEW; END IF;
  IF OLD.status::text = 'delivered' THEN RETURN NEW; END IF;
  IF NEW.store_id IS NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.store_charge, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;

  -- Skip if already credited
  IF EXISTS (
    SELECT 1 FROM public.store_wallet_ledger swl
    WHERE swl.order_id = NEW.id AND swl.type = 'order_earning'
  ) THEN RETURN NEW; END IF;

  -- Credit the store wallet
  INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
  VALUES (NEW.store_id, v_amount, 0, v_amount)
  ON CONFLICT (store_id) DO UPDATE
    SET available_balance = public.store_wallets.available_balance + v_amount,
        lifetime_earnings = public.store_wallets.lifetime_earnings + v_amount,
        updated_at = now();

  -- Log the ledger entry
  INSERT INTO public.store_wallet_ledger (store_id, order_id, type, amount, description)
  VALUES (
    NEW.store_id, NEW.id, 'order_earning', v_amount,
    CASE WHEN COALESCE(NEW.payment_method, 'card') = 'cash'
         THEN 'Μερίδιο καταστήματος (μετρητά)'
         ELSE 'Μερίδιο καταστήματος (κάρτα)' END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_store_wallet_on_delivery ON public.orders;
CREATE TRIGGER trg_credit_store_wallet_on_delivery
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.credit_store_wallet_on_delivery();

-- Backfill: credit store wallets for all delivered orders that are missing the credit
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT o.id AS order_id, o.store_id, o.store_charge, o.payment_method
      FROM public.orders o
     WHERE o.status = 'delivered'
       AND o.store_id IS NOT NULL
       AND COALESCE(o.store_charge, 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.store_wallet_ledger swl
          WHERE swl.order_id = o.id AND swl.type = 'order_earning'
       )
  LOOP
    INSERT INTO public.store_wallets (store_id, available_balance, pending_balance, lifetime_earnings)
    VALUES (r.store_id, r.store_charge, 0, r.store_charge)
    ON CONFLICT (store_id) DO UPDATE
      SET available_balance = public.store_wallets.available_balance + r.store_charge,
          lifetime_earnings = public.store_wallets.lifetime_earnings + r.store_charge,
          updated_at = now();

    INSERT INTO public.store_wallet_ledger (store_id, order_id, type, amount, description)
    VALUES (r.store_id, r.order_id, 'order_earning', r.store_charge,
            CASE WHEN COALESCE(r.payment_method, 'card') = 'cash'
                 THEN 'Μερίδιο καταστήματος (μετρητά) - backfill'
                 ELSE 'Μερίδιο καταστήματος (κάρτα) - backfill' END);
  END LOOP;
END $$;
