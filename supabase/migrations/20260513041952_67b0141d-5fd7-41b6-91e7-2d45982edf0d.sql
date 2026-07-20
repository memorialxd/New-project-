
-- Drop legacy duplicate-payout triggers; settle_order_commission is canonical
DROP TRIGGER IF EXISTS settle_money_bags_on_delivery ON public.orders;
DROP TRIGGER IF EXISTS trg_auto_earning_on_delivery ON public.orders;

-- Reverse the 8€ over-credit on the test order
DO $$
DECLARE
  v_driver uuid := '3fbd26ff-f356-4cb9-903d-2854bf9d09ba';
  v_order  uuid := '26178fef-73aa-465d-9764-b37827acda26';
  v_over   numeric := 8.00;
BEGIN
  UPDATE public.driver_wallets
    SET available_balance = GREATEST(available_balance - v_over, 0),
        updated_at = now()
    WHERE driver_id = v_driver;

  INSERT INTO public.wallet_transactions (driver_id, type, amount, status, description, order_id)
  VALUES (v_driver, 'admin_debit', -v_over, 'completed',
          'Reversal: legacy duplicate payout (Fair pay 3€ + Delivery 5€)', v_order);
END $$;
