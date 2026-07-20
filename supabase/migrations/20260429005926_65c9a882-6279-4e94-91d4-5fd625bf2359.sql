
-- 1) Add a 'reversed' status marker support (text column, no schema change needed)
-- 2) Mark orphan earning_credit rows (no order_id) as reversed
UPDATE public.wallet_transactions
SET status = 'reversed',
    description = COALESCE(description, '') || ' [auto-reversed: orphan duplicate from trigger bug]'
WHERE type = 'earning_credit'
  AND status = 'completed'
  AND order_id IS NULL;

-- 3) For each (driver_id, order_id) keep the OLDEST earning_credit, reverse the rest
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY driver_id, order_id ORDER BY created_at ASC) AS rn
  FROM public.wallet_transactions
  WHERE type = 'earning_credit'
    AND status = 'completed'
    AND order_id IS NOT NULL
)
UPDATE public.wallet_transactions wt
SET status = 'reversed',
    description = COALESCE(wt.description, '') || ' [auto-reversed: duplicate from trigger bug]'
FROM ranked
WHERE wt.id = ranked.id AND ranked.rn > 1;

-- 4) Recompute driver_wallets.available_balance from truth
--    real_credits = sum of remaining 'completed' earning_credit + support_credit + manual_credit etc.
--    withdrawn   = wallet.total_withdrawn (already correct, equals completed withdrawal_request)
WITH real_credits AS (
  SELECT driver_id, COALESCE(SUM(amount), 0) AS credited
  FROM public.wallet_transactions
  WHERE status = 'completed'
    AND type IN ('earning_credit','support_credit','manual_credit','bonus','referral_bonus','topup')
  GROUP BY driver_id
),
recomputed AS (
  SELECT dw.driver_id,
         COALESCE(rc.credited, 0) - dw.total_withdrawn AS new_balance,
         dw.available_balance AS old_balance,
         COALESCE(rc.credited, 0) AS credited
  FROM public.driver_wallets dw
  LEFT JOIN real_credits rc ON rc.driver_id = dw.driver_id
)
UPDATE public.driver_wallets dw
SET available_balance = GREATEST(r.new_balance, 0),
    updated_at = now()
FROM recomputed r
WHERE dw.driver_id = r.driver_id;

-- 5) Log overpayments (where reconciled balance went negative) into admin_audit_log
INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, description, metadata)
SELECT
  dw.driver_id,
  'system',
  'wallet_reconciliation',
  'driver_wallet',
  dw.driver_id::text,
  'Driver overpaid due to duplicate-trigger bug. Balance clamped to 0.',
  jsonb_build_object(
    'old_balance', r.old_balance,
    'real_credits', r.credited,
    'total_withdrawn', dw.total_withdrawn,
    'computed_balance', r.new_balance,
    'overpayment', ABS(r.new_balance)
  )
FROM public.driver_wallets dw
JOIN (
  WITH real_credits AS (
    SELECT driver_id, COALESCE(SUM(amount), 0) AS credited
    FROM public.wallet_transactions
    WHERE status = 'completed'
      AND type IN ('earning_credit','support_credit','manual_credit','bonus','referral_bonus','topup')
    GROUP BY driver_id
  )
  SELECT dw2.driver_id,
         COALESCE(rc.credited, 0) - dw2.total_withdrawn AS new_balance,
         COALESCE(rc.credited, 0) AS credited,
         (COALESCE(rc.credited, 0) - dw2.total_withdrawn) AS old_balance
  FROM public.driver_wallets dw2
  LEFT JOIN real_credits rc ON rc.driver_id = dw2.driver_id
) r ON r.driver_id = dw.driver_id
WHERE r.new_balance < 0;
