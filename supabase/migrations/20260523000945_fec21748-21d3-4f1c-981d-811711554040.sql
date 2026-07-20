
CREATE INDEX IF NOT EXISTS idx_orders_dispatch_candidates
  ON public.orders (status, predicted_ready_at, created_at)
  WHERE driver_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_offers_status_expires
  ON public.pending_offers (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_pending_offers_order
  ON public.pending_offers (order_id);

CREATE INDEX IF NOT EXISTS idx_driver_offer_events_recent
  ON public.driver_offer_events (action, created_at);

CREATE INDEX IF NOT EXISTS idx_driver_locations_driver
  ON public.driver_locations (driver_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_runs_started
  ON public.dispatch_runs (started_at DESC);
