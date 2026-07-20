
CREATE OR REPLACE FUNCTION public.run_due_basket_distributions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  ran integer := 0;
BEGIN
  FOR r IN
    SELECT id, schedule
    FROM public.basket_distribution_rules
    WHERE is_active = true
      AND schedule IN ('weekly', 'monthly')
      AND (next_run_at IS NULL OR next_run_at <= now())
  LOOP
    BEGIN
      PERFORM public.run_basket_distribution(r.id);
      UPDATE public.basket_distribution_rules
      SET next_run_at = CASE
            WHEN r.schedule = 'weekly'  THEN now() + interval '7 days'
            WHEN r.schedule = 'monthly' THEN now() + interval '1 month'
            ELSE next_run_at
          END,
          last_run_at = now()
      WHERE id = r.id;
      ran := ran + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.admin_audit_log(actor_id, action, target_type, target_id, description, metadata)
      VALUES (
        '00000000-0000-0000-0000-000000000000'::uuid,
        'basket_auto_distribution_failed',
        'basket_rule', r.id::text,
        SQLERRM, jsonb_build_object('rule_id', r.id)
      );
    END;
  END LOOP;
  RETURN ran;
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_due_basket_distributions() TO service_role;
