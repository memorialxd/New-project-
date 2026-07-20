DO $$
DECLARE
  v_order_id uuid := '26178fef-73aa-465d-9764-b37827acda26';
  v_driver_id uuid := '3fbd26ff-f356-4cb9-903d-2854bf9d09ba';
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (v_driver_id, 'driver')
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.orders SET driver_id=v_driver_id, status='accepted', dispatch_at=now() WHERE id=v_order_id;
  UPDATE public.orders SET status='preparing' WHERE id=v_order_id;
  UPDATE public.orders SET status='ready' WHERE id=v_order_id;
  UPDATE public.orders SET status='picked_up' WHERE id=v_order_id;
  UPDATE public.orders SET status='delivered' WHERE id=v_order_id;
END $$;