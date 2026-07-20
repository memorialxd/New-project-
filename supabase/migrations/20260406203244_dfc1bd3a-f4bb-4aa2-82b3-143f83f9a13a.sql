
CREATE TABLE public.driver_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  vehicle_type TEXT DEFAULT 'motorcycle',
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  license_plate TEXT,
  license_number TEXT,
  license_expiry DATE,
  id_document_url TEXT,
  license_document_url TEXT,
  bank_name TEXT,
  account_holder TEXT,
  iban TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers can view own driver profile"
ON public.driver_profiles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Drivers can insert own driver profile"
ON public.driver_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Drivers can update own driver profile"
ON public.driver_profiles FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all driver profiles"
ON public.driver_profiles FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_driver_profiles_updated_at
BEFORE UPDATE ON public.driver_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
