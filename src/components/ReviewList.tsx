import { useState, useEffect } from 'react';
import { Star, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface ReviewListProps {
  storeId: string;
}

export function ReviewList({ storeId }: ReviewListProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [avgRating, setAvgRating] = useState(0);

  useEffect(() => {
    supabase
      .rpc('get_public_reviews' as any, { p_store_id: storeId })
      .then(({ data }) => {
        const all = ((data ?? []) as Review[])
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const items = all.slice(0, 20);
        setReviews(items);
        if (all.length > 0) {
          setAvgRating(all.reduce((sum, r) => sum + r.rating, 0) / all.length);
        }
        setLoading(false);
      });
  }, [storeId]);

  if (loading) return null;
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">Δεν υπάρχουν κριτικές ακόμα</p>
    );
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('el-GR', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        <div className="flex items-center gap-1">
          <Star className="h-5 w-5 fill-warning text-warning" />
          <span className="font-heading font-bold text-foreground text-lg">{avgRating.toFixed(1)}</span>
        </div>
        <span className="text-sm text-muted-foreground">({reviews.length} κριτικ{reviews.length !== 1 ? 'ές' : 'ή'})</span>
      </div>

      {reviews.map(review => (
        <Card key={review.id} className="shadow-[var(--shadow-sm)]">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`h-3.5 w-3.5 ${
                      i < review.rating ? 'fill-warning text-warning' : 'text-muted'
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{formatDate(review.created_at)}</span>
            </div>
            {review.comment && (
              <p className="text-sm text-foreground mt-1">{review.comment}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function RatingBadge({ storeId }: { storeId: string }) {
  const [avg, setAvg] = useState<number | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    supabase
      .rpc('get_public_reviews' as any, { p_store_id: storeId })
      .then(({ data }) => {
        const items = (data ?? []) as { rating: number }[];
        if (items.length > 0) {
          setAvg(items.reduce((s, r) => s + r.rating, 0) / items.length);
          setCount(items.length);
        }
      });
  }, [storeId]);

  if (avg === null) return null;

  return (
    <span className="flex items-center gap-1 text-sm">
      <Star className="h-3.5 w-3.5 fill-warning text-warning" />
      <span className="font-heading font-semibold text-foreground">{avg.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
    </span>
  );
}
