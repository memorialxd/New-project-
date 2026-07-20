ALTER TABLE public.stores REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stores;