-- ============================================
-- 1. FEATURE FLAGS
-- ============================================
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage feature flags"
  ON public.feature_flags FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users read feature flags"
  ON public.feature_flags FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.feature_flags (key, label, description, category) VALUES
  ('new_orders_enabled', 'Νέες παραγγελίες', 'Επιτρέπει στους πελάτες να κάνουν νέες παραγγελίες', 'orders'),
  ('new_signups_enabled', 'Νέες εγγραφές', 'Επιτρέπει νέες εγγραφές χρηστών', 'auth'),
  ('driver_signups_enabled', 'Εγγραφές οδηγών', 'Επιτρέπει νέες εγγραφές οδηγών', 'auth'),
  ('store_signups_enabled', 'Εγγραφές καταστημάτων', 'Επιτρέπει νέες εγγραφές καταστημάτων', 'auth'),
  ('driver_payouts_enabled', 'Πληρωμές οδηγών', 'Επιτρέπει αιτήσεις cash-out', 'finance'),
  ('promo_codes_enabled', 'Κωδικοί έκπτωσης', 'Επιτρέπει χρήση promo codes στο checkout', 'orders'),
  ('reviews_enabled', 'Κριτικές', 'Επιτρέπει στους πελάτες να αφήνουν κριτικές', 'general'),
  ('chat_support_enabled', 'Chat υποστήριξης', 'Ενεργοποιεί ζωντανό chat με support', 'support'),
  ('ai_support_enabled', 'AI Support', 'Ενεργοποιεί τον AI βοηθό υποστήριξης', 'support')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 2. MAINTENANCE MODE on platform_settings
-- ============================================
ALTER TABLE public.platform_settings 
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message TEXT;

-- ============================================
-- 3. ADMIN SUB-ROLES (permissions)
-- ============================================
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'full',
  can_manage_finances BOOLEAN NOT NULL DEFAULT false,
  can_manage_users BOOLEAN NOT NULL DEFAULT false,
  can_manage_orders BOOLEAN NOT NULL DEFAULT false,
  can_manage_settings BOOLEAN NOT NULL DEFAULT false,
  can_view_audit BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage admin permissions"
  ON public.admin_permissions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_admin_permissions_updated_at
  BEFORE UPDATE ON public.admin_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 4. ADMIN AUDIT LOG
-- ============================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON public.admin_audit_log (actor_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view audit log"
  ON public.admin_audit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert audit log"
  ON public.admin_audit_log FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_id = auth.uid());

-- Helper to log admin actions
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action TEXT,
  p_target_type TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can log audit actions';
  END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.admin_audit_log (actor_id, actor_name, action, target_type, target_id, description, metadata)
  VALUES (auth.uid(), v_name, p_action, p_target_type, p_target_id, p_description, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

-- ============================================
-- 5. SURGE ZONES (operational override)
-- ============================================
CREATE TABLE IF NOT EXISTS public.surge_zones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  radius_km NUMERIC NOT NULL DEFAULT 2.0,
  multiplier NUMERIC NOT NULL DEFAULT 1.5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.surge_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage surge zones"
  ON public.surge_zones FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read active surge zones"
  ON public.surge_zones FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active = true);

CREATE TRIGGER update_surge_zones_updated_at
  BEFORE UPDATE ON public.surge_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 6. BANNED DEVICES
-- ============================================
CREATE TABLE IF NOT EXISTS public.banned_devices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_fingerprint TEXT NOT NULL UNIQUE,
  user_id UUID,
  reason TEXT,
  banned_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.banned_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage banned devices"
  ON public.banned_devices FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
