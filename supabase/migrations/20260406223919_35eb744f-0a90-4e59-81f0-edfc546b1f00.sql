
ALTER TABLE public.stores DISABLE TRIGGER protect_store_active;
UPDATE public.stores SET is_active = false WHERE name = 'Pizza' AND address = 'Ggvvxf';
ALTER TABLE public.stores ENABLE TRIGGER protect_store_active;
