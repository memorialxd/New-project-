CREATE POLICY "Drivers can insert own earnings"
ON public.earnings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = driver_id);