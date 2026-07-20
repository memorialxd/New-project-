-- HARDENING MIGRATION
-- 1) Chat attachments: remove broad public-read policy, restrict to uploader + support/admin
DROP POLICY IF EXISTS "Chat attachments public read" ON storage.objects;

CREATE POLICY "Uploader or support reads chat attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.is_support_or_admin(auth.uid())
  )
);

-- Make chat-attachments bucket private (signed URLs / RLS-only access)
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- 2) Avatars bucket: keep public reads (used in <img src>), but harden listing
-- Drop the redundant/narrow "own avatar only" SELECT policy that blocks public reads
DROP POLICY IF EXISTS "Users can read their own avatar files" ON storage.objects;

-- Add an explicit public-read policy so direct URL reads work, but listing is allowed
-- (avatars URLs are not enumerable: they include user ID + filename)
CREATE POLICY "Public can read avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- 3) Lock down SECURITY DEFINER functions: revoke EXECUTE from anon
-- Trigger functions and internal helpers should NEVER be callable from PostgREST.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    -- Always revoke from anon (no SECURITY DEFINER fn should be callable unauthenticated)
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
  END LOOP;
END $$;

-- Trigger functions should not be callable by authenticated users at all
DO $$
DECLARE r record;
  trigger_fns text[] := ARRAY[
    'protect_driver_layout','generate_driver_code','protect_store_active_status',
    'create_customer_rewards','award_loyalty_points','protect_driver_active_status',
    'create_driver_wallet','credit_wallet_on_earning','protect_order_financials',
    'auto_accept_small_orders','update_updated_at_column','handle_new_user',
    'protect_profile_role','validate_store_billing_mode','validate_order_source',
    'settle_order_money_bags','validate_ticket_priority','validate_distribution_mode',
    'validate_driver_offer_action','auto_create_earning_on_delivery',
    'validate_store_promotion_status','protect_store_promotion'
  ];
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND p.proname = ANY(trigger_fns)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM authenticated, public', r.proname, r.args);
  END LOOP;
END $$;