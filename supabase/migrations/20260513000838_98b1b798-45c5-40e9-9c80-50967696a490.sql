DROP VIEW IF EXISTS public.basket_health;
CREATE VIEW public.basket_health
WITH (security_invoker = true) AS
SELECT
  t.platform_pool                                       AS current_balance,
  t.lifetime_platform_earned                            AS lifetime_in,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions),0) AS lifetime_distributed,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions
             WHERE created_at >= now() - interval '7 days'),0)            AS distributed_7d,
  COALESCE((SELECT SUM(total_amount) FROM public.basket_distributions
             WHERE created_at >= now() - interval '30 days'),0)           AS distributed_30d,
  (SELECT MAX(created_at) FROM public.basket_distributions)               AS last_distribution_at
FROM public.admin_treasury t WHERE t.id = 1;
GRANT SELECT ON public.basket_health TO authenticated;