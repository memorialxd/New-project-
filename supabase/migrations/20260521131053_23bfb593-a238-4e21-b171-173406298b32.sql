-- Customer app configuration with draft/publish workflow
CREATE TABLE IF NOT EXISTS public.customer_app_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true), -- single-row table
  draft_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  published_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.customer_app_config ENABLE ROW LEVEL SECURITY;

-- Everyone (including anon) can read the published config (it's used on the public customer home)
CREATE POLICY "Anyone can read customer app config"
  ON public.customer_app_config FOR SELECT
  USING (true);

-- Only admins can update / publish
CREATE POLICY "Admins manage customer app config"
  ON public.customer_app_config FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed with defaults matching the current hard-coded UI
INSERT INTO public.customer_app_config (id, draft_config, published_config)
VALUES (
  true,
  jsonb_build_object(
    'branding', jsonb_build_object(
      'app_name', 'Fresh Delivery',
      'city_label', 'Ιωάννινα',
      'accent_hsl', '4 90% 47%',
      'accent_dark_hsl', '4 90% 38%',
      'logo_url', null
    ),
    'tiles', jsonb_build_array(
      jsonb_build_object('label','Φαγητό','emoji','🍔','category','all'),
      jsonb_build_object('label','Πίτσα','emoji','🍕','category','Πίτσες'),
      jsonb_build_object('label','Καφές','emoji','☕','category','Καφέδες'),
      jsonb_build_object('label','Γλυκά','emoji','🍰','category','Γλυκά')
    ),
    'promos', jsonb_build_array(
      jsonb_build_object('tag','NEW','title','Δωρεάν παράδοση','subtitle','στην πρώτη σου παραγγελία','code','WELCOME','gradient','hero','enabled',true),
      jsonb_build_object('tag','−20%','title','Έκπτωση 20%','subtitle','στις 3 πρώτες παραγγελίες','code','NEW20','gradient','dark','enabled',true),
      jsonb_build_object('tag','FLASH','title','Δωρεάν γλυκό','subtitle','σε παραγγελίες άνω των 15€','code','SWEET','gradient','hero','enabled',true)
    ),
    'sections', jsonb_build_object(
      'show_tiles', true,
      'show_promos', true,
      'show_categories', true,
      'show_promoted', true,
      'show_nearby', true
    )
  ),
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- After insert: publish the seeded draft so the live app immediately gets defaults
UPDATE public.customer_app_config
SET published_config = draft_config, published_at = now()
WHERE id = true AND published_config = '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.touch_customer_app_config()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_customer_app_config ON public.customer_app_config;
CREATE TRIGGER trg_touch_customer_app_config
  BEFORE UPDATE ON public.customer_app_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_customer_app_config();

ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_app_config;