import { useState } from 'react';
import { Star, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface ReviewFormProps {
  orderId: string;
  storeId: string;
  onSubmitted?: () => void;
}

export function ReviewForm({ orderId, storeId, onSubmitted }: ReviewFormProps) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user || rating === 0) {
      toast.error('Παρακαλώ επιλέξτε βαθμολογία');
      return;
    }
    if (comment.length > 500) {
      toast.error('Η κριτική πρέπει να είναι κάτω από 500 χαρακτήρες');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('reviews').insert({
      customer_id: user.id,
      store_id: storeId,
      order_id: orderId,
      rating,
      comment: comment.trim() || null,
    } as any);

    if (error) {
      if (error.code === '23505') {
        toast.error('Έχετε ήδη αξιολογήσει αυτή την παραγγελία');
      } else {
        toast.error('Αποτυχία υποβολής κριτικής');
      }
    } else {
      toast.success('Η κριτική υποβλήθηκε! Ευχαριστούμε 🎉');
      onSubmitted?.();
    }
    setSubmitting(false);
  };

  return (
    <Card className="shadow-[var(--shadow-md)] border-primary/20">
      <CardHeader className="pb-2">
        <CardTitle className="font-heading text-lg">Βαθμολογήστε την παραγγελία σας</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map(star => (
            <button
              key={star}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(star)}
              className="p-1 transition-transform hover:scale-110"
            >
              <Star
                className={`h-8 w-8 transition-colors ${
                  star <= (hoverRating || rating)
                    ? 'fill-warning text-warning'
                    : 'text-muted-foreground'
                }`}
              />
            </button>
          ))}
        </div>
        {rating > 0 && (
          <p className="text-center text-sm text-muted-foreground font-heading">
            {['', 'Κακό', 'Μέτριο', 'Καλό', 'Πολύ Καλό', 'Εξαιρετικό!'][rating]}
          </p>
        )}
        <Textarea
          placeholder="Πείτε μας για την εμπειρία σας (προαιρετικά)"
          value={comment}
          onChange={e => setComment(e.target.value)}
          maxLength={500}
          className="resize-none"
          rows={3}
        />
        <Button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="w-full gradient-primary text-primary-foreground font-heading"
        >
          <Send className="h-4 w-4 mr-2" />
          {submitting ? 'Υποβολή...' : 'Υποβολή Κριτικής'}
        </Button>
      </CardContent>
    </Card>
  );
}
