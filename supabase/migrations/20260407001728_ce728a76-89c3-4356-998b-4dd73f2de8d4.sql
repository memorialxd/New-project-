CREATE POLICY "Admins can view all driver locations"
ON public.driver_locations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));