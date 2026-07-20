ALTER TABLE public.stores DISABLE TRIGGER USER;

UPDATE public.stores SET is_active = false 
WHERE id NOT IN (SELECT id FROM public.stores ORDER BY created_at ASC, name ASC LIMIT 10);

ALTER TABLE public.stores ENABLE TRIGGER USER;