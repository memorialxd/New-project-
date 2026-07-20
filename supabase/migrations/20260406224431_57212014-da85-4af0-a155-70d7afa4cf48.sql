
ALTER TABLE public.stores DISABLE TRIGGER protect_store_active;

UPDATE public.stores SET is_active = false 
WHERE name IN ('Souvlaki House', 'Pizza Napoli', 'Μπουγάτσα Θεσσαλονίκη', 'Burger Lab', 'Sushi Master', 'Κρεπερί La Crêpe', 'Τα Ψητά του Μάκη', 'Wok & Roll');

ALTER TABLE public.stores ENABLE TRIGGER protect_store_active;
