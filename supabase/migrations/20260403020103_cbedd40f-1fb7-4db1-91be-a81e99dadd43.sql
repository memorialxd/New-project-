
CREATE TABLE public.reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL,
  store_id UUID NOT NULL,
  order_id UUID NOT NULL UNIQUE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews viewable by everyone"
ON public.reviews FOR SELECT USING (true);

CREATE POLICY "Customers can create reviews for own orders"
ON public.reviews FOR INSERT
WITH CHECK (
  auth.uid() = customer_id
  AND EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = reviews.order_id
      AND orders.customer_id = auth.uid()
      AND orders.status = 'delivered'
  )
);

CREATE POLICY "Customers can update own reviews"
ON public.reviews FOR UPDATE
USING (auth.uid() = customer_id);

CREATE INDEX idx_reviews_store_id ON public.reviews(store_id);
CREATE INDEX idx_reviews_order_id ON public.reviews(order_id);

CREATE TRIGGER update_reviews_updated_at
BEFORE UPDATE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
