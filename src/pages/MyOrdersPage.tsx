import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Clock, CheckCircle2, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { RewardsCard } from '@/components/customer/RewardsCard';
import { CustomerWalletCard } from '@/components/customer/CustomerWalletCard';
import { CustomerReferralCard } from '@/components/customer/CustomerReferralCard';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';
import { SEO } from '@/components/SEO';
import { formatOrderNumber } from '@/lib/order-number';

type OrderRow = Database['public']['Tables']['orders']['Row'];

const statusLabels: Record<string, { label: string; color: string }> = {
  placed: { label: 'Καταχωρήθηκε', color: 'bg-info/10 text-info border-info/30' },
  accepted: { label: 'Αποδεκτή', color: 'bg-info/10 text-info border-info/30' },
  preparing: { label: 'Ετοιμάζεται', color: 'bg-warning/10 text-warning border-warning/30' },
  ready: { label: 'Έτοιμη', color: 'bg-success/10 text-success border-success/30' },
  picked_up: { label: 'Σε Μεταφορά', color: 'bg-primary/10 text-primary border-primary/30' },
  delivered: { label: 'Παραδόθηκε', color: 'bg-success/10 text-success border-success/30' },
  cancelled: { label: 'Ακυρωμένη', color: 'bg-destructive/10 text-destructive border-destructive/30' },
};

export default function MyOrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addItem } = useCart();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reorder = async (orderId: string, storeId: string) => {
    const [{ data: items }, { data: store }] = await Promise.all([
      supabase.from('order_items').select('menu_item_id, name, quantity, unit_price').eq('order_id', orderId),
      supabase.from('stores').select('id, name').eq('id', storeId).maybeSingle(),
    ]);
    if (!items?.length || !store) {
      toast.error('Δεν βρέθηκαν προϊόντα');
      return;
    }
    items.forEach((i) => {
      if (!i.menu_item_id) return;
      for (let q = 0; q < i.quantity; q++) {
        addItem(store.id, store.name, {
          menuItemId: i.menu_item_id,
          name: i.name,
          price: Number(i.unit_price),
        });
      }
    });
    toast.success(`${items.length} προϊόντα προστέθηκαν στο καλάθι`);
    navigate('/checkout');
  };

  useEffect(() => {
    if (!user) return;
    supabase
      .from('orders')
      .select('*')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setOrders(data ?? []);
        setLoading(false);
      });
  }, [user]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('el-GR', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Οι παραγγελίες μου — Fresh Delivery"
        description="Δείτε το ιστορικό παραγγελιών σας, παρακολουθήστε ενεργές αποστολές και επαναλάβετε αγαπημένες παραγγελίες."
        path="/orders"
        noindex
      />
      <header className="bg-card border-b border-border px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
        <button onClick={() => navigate('/order')} aria-label="Επιστροφή στα εστιατόρια" className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="font-heading font-bold text-lg text-foreground">Οι Παραγγελίες μου</h1>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        <RewardsCard />
        <CustomerWalletCard />
        <CustomerReferralCard />
        {loading ? (
          <div className="text-center py-16">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="font-heading text-foreground">Δεν υπάρχουν παραγγελίες</p>
            <p className="text-sm text-muted-foreground mt-1">Το ιστορικό παραγγελιών σας θα εμφανίζεται εδώ</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => {
              const status = statusLabels[order.status] ?? statusLabels.placed;
              const isActive = !['delivered', 'cancelled'].includes(order.status);
              const isDelivered = order.status === 'delivered';
              return (
                <Card
                  key={order.id}
                  className={`shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow ${isActive ? 'border-primary/20' : ''}`}
                >
                  <CardContent className="p-4">
                    <div onClick={() => navigate(`/order-tracking/${order.id}`)} className="cursor-pointer">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs font-bold text-foreground">{formatOrderNumber(order as any)}</span>
                        <Badge variant="outline" className={`text-xs font-heading ${status.color}`}>
                          {status.label}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{formatDate(order.created_at)}</span>
                        <span className="font-heading font-bold text-foreground">{Number(order.total_amount).toFixed(2)}€</span>
                      </div>
                      {order.delivery_address && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{order.delivery_address}</p>
                      )}
                      {isActive && (
                        <p className="text-xs text-primary font-heading mt-2">Πατήστε για παρακολούθηση →</p>
                      )}
                    </div>
                    {isDelivered && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full mt-3 font-heading"
                        onClick={(e) => { e.stopPropagation(); reorder(order.id, order.store_id); }}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Επανάληψη παραγγελίας
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
