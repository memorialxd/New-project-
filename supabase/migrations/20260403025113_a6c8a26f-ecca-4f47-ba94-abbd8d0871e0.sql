
CREATE TABLE public.platform_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  assignment_mode TEXT NOT NULL DEFAULT 'auto' CHECK (assignment_mode IN ('auto', 'nearest', 'manual')),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage platform settings"
  ON public.platform_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view settings"
  ON public.platform_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

INSERT INTO public.platform_settings (id, assignment_mode) VALUES (1, 'auto');

-- Update trigger to check assignment mode
CREATE OR REPLACE FUNCTION public.assign_random_driver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  random_driver_id UUID;
  current_mode TEXT;
BEGIN
  IF NEW.driver_id IS NULL AND NEW.status IN ('pending', 'placed') THEN
    SELECT assignment_mode INTO current_mode FROM public.platform_settings WHERE id = 1;

    IF current_mode = 'auto' THEN
      SELECT p.user_id INTO random_driver_id
      FROM public.profiles p
      WHERE p.role = 'driver'
      ORDER BY random()
      LIMIT 1;
      IF random_driver_id IS NOT NULL THEN
        NEW.driver_id := random_driver_id;
      END IF;

    ELSIF current_mode = 'nearest' THEN
      -- Assign nearest driver by location if delivery coordinates exist
      IF NEW.delivery_latitude IS NOT NULL AND NEW.delivery_longitude IS NOT NULL THEN
        SELECT dl.driver_id INTO random_driver_id
        FROM public.driver_locations dl
        JOIN public.profiles p ON p.user_id = dl.driver_id AND p.role = 'driver'
        ORDER BY (
          (dl.latitude - NEW.delivery_latitude) * (dl.latitude - NEW.delivery_latitude) +
          (dl.longitude - NEW.delivery_longitude) * (dl.longitude - NEW.delivery_longitude)
        )
        LIMIT 1;
        IF random_driver_id IS NOT NULL THEN
          NEW.driver_id := random_driver_id;
        END IF;
      ELSE
        -- Fallback to random if no coordinates
        SELECT p.user_id INTO random_driver_id
        FROM public.profiles p
        WHERE p.role = 'driver'
        ORDER BY random()
        LIMIT 1;
        IF random_driver_id IS NOT NULL THEN
          NEW.driver_id := random_driver_id;
        END IF;
      END IF;

    -- 'manual' mode: do nothing, admin assigns manually
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
