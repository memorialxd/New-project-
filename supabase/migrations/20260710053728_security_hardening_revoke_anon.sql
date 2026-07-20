-- Revoke EXECUTE from anon on admin-only functions that were granted to anon
-- credit_customer_wallet and admin_adjust_wallet are admin-only despite being
-- called from customer-facing components (the calls are best-effort and fail safely)

REVOKE EXECUTE ON FUNCTION public.credit_customer_wallet(p_user_id uuid, p_amount numeric, p_type text, p_description text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_wallet(p_driver_id uuid, p_amount numeric, p_description text) FROM anon;

-- Also revoke from anon on refund_order (admin/support only)
REVOKE EXECUTE ON FUNCTION public.refund_order(p_order_id uuid, p_amount numeric, p_reason text, p_refund_type text, p_notes text) FROM anon;

-- Revoke from anon on create_driver_earning (trigger/internal)
REVOKE EXECUTE ON FUNCTION public.create_driver_earning(p_driver_id uuid, p_order_id uuid, p_base_pay numeric, p_tip numeric, p_bonus numeric) FROM anon;

-- Revoke from anon on email queue functions (edge function only via service role)
REVOKE EXECUTE ON FUNCTION public.enqueue_email(queue_name text, payload jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_email(queue_name text, message_id bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) FROM anon;

-- Revoke from anon on get_treasury_health (admin only)
REVOKE EXECUTE ON FUNCTION public.get_treasury_health() FROM anon;

-- Revoke from anon on run_basket_distribution and run_due_basket_distributions (admin only)
REVOKE EXECUTE ON FUNCTION public.run_basket_distribution(_rule_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_due_basket_distributions() FROM anon;

-- Revoke from anon on create_custom_order and create_external_order (admin/store only)
REVOKE EXECUTE ON FUNCTION public.create_custom_order(uuid, numeric, text, double precision, double precision, numeric, text, text, text, text, text, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_custom_order(uuid, numeric, text, double precision, double precision, numeric, text, text, text, text, text, numeric, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_external_order(uuid, text, numeric, text, double precision, double precision, numeric, text, text, text, text, numeric, numeric, text, text) FROM anon;

-- Revoke from anon on log_admin_action (admin only)
REVOKE EXECUTE ON FUNCTION public.log_admin_action(p_action text, p_target_type text, p_target_id text, p_description text, p_metadata jsonb) FROM anon;

-- Revoke from anon on count_active_support_agents (support only)
REVOKE EXECUTE ON FUNCTION public.count_active_support_agents() FROM anon;
