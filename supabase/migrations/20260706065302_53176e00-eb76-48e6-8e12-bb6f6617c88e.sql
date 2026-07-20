
CREATE POLICY "Public read app-branding" ON storage.objects FOR SELECT USING (bucket_id = 'app-branding');
CREATE POLICY "Admins upload app-branding" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'app-branding' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update app-branding" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'app-branding' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete app-branding" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'app-branding' AND public.has_role(auth.uid(), 'admin'));
