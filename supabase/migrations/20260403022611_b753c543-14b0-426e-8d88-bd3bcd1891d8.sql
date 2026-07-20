
-- Admin can update any store
CREATE POLICY "Admins can update all stores"
  ON public.stores FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin can update any profile
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));
