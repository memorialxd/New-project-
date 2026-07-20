-- Drop the duplicate trigger on earnings; keep trg_credit_wallet_on_earning
DROP TRIGGER IF EXISTS credit_wallet_after_earning ON public.earnings;

-- Remove the lifecycle test order (was stuck at status='placed', no settlement)
DELETE FROM public.order_items WHERE order_id = '7d1763b7-d13b-4b82-b38c-a90b610e020e';
DELETE FROM public.orders WHERE id = '7d1763b7-d13b-4b82-b38c-a90b610e020e';