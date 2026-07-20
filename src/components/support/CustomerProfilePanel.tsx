import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { User, Phone, Wallet, Gift, ShoppingBag, Star, AlertTriangle } from 'lucide-react';

interface CustomerProfilePanelProps {
  userId: string;
}

interface Customer360 {
  fullName: string | null;
  phone: string | null;
  joinedAt: string | null;
  totalOrders: number;
  totalSpent: number;
  avgRating: number | null;
  walletBalance: number;
  lifetimeCredit: number;
  rewardPoints: number;
  rewardTier: string;
  refundCount: number;
  lastOrderAt: string | null;
}

export function CustomerProfilePanel({ userId }: CustomerProfilePanelProps) {
  const [data, setData] = useState<Customer360 | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [profile, orders, wallet, rewards, refunds, ratings] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, created_at').eq('user_id', userId).maybeSingle(),
        supabase.from('orders').select('total_amount, created_at').eq('customer_id', userId),
        supabase.from('customer_wallets').select('balance, lifetime_credit').eq('user_id', userId).maybeSingle(),
        supabase.from('customer_rewards').select('points, tier').eq('user_id', userId).maybeSingle(),
        supabase.from('refunds').select('id', { count: 'exact', head: true }).eq('customer_id', userId),
        supabase.from('reviews').select('rating').eq('customer_id', userId),
      ]);

      if (cancelled) return;

      const orderRows = orders.data ?? [];
      const totalSpent = orderRows.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
      const lastOrderAt = orderRows.length > 0
        ? orderRows.map(o => o.created_at).sort().reverse()[0]
        : null;
      const ratingRows = ratings.data ?? [];
      const avgRating = ratingRows.length > 0
        ? ratingRows.reduce((s, r) => s + Number(r.rating), 0) / ratingRows.length
        : null;

      setData({
        fullName: profile.data?.full_name ?? null,
        phone: profile.data?.phone ?? null,
        joinedAt: profile.data?.created_at ?? null,
        totalOrders: orderRows.length,
        totalSpent,
        avgRating,
        walletBalance: Number(wallet.data?.balance ?? 0),
        lifetimeCredit: Number(wallet.data?.lifetime_credit ?? 0),
        rewardPoints: rewards.data?.points ?? 0,
        rewardTier: rewards.data?.tier ?? 'bronze',
        refundCount: refunds.count ?? 0,
        lastOrderAt,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const tierColor: Record<string, string> = {
    bronze: 'bg-amber-700/10 text-amber-700 border-amber-700/30',
    silver: 'bg-slate-400/10 text-slate-500 border-slate-400/30',
    gold: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
    platinum: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4" /> Πελάτης 360°
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="font-semibold">{data.fullName || 'Ανώνυμος'}</div>
          {data.phone && (
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Phone className="h-3 w-3" /> {data.phone}
            </div>
          )}
          {data.joinedAt && (
            <div className="text-xs text-muted-foreground mt-1">
              Μέλος από {new Date(data.joinedAt).toLocaleDateString('el-GR')}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat icon={ShoppingBag} label="Παραγγελίες" value={data.totalOrders.toString()} />
          <Stat icon={ShoppingBag} label="Σύνολο" value={`€${data.totalSpent.toFixed(2)}`} />
          <Stat icon={Wallet} label="Πορτοφόλι" value={`€${data.walletBalance.toFixed(2)}`} />
          <Stat icon={Gift} label="Πιστώσεις" value={`€${data.lifetimeCredit.toFixed(2)}`} />
          <Stat
            icon={Star}
            label="Μ.Ο. βαθμολογιών"
            value={data.avgRating ? data.avgRating.toFixed(1) : '—'}
          />
          <Stat
            icon={AlertTriangle}
            label="Επιστροφές"
            value={data.refundCount.toString()}
            warning={data.refundCount >= 3}
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center pt-1">
          <Badge variant="outline" className={tierColor[data.rewardTier] ?? ''}>
            {data.rewardTier.toUpperCase()} · {data.rewardPoints} pts
          </Badge>
          {data.refundCount >= 3 && (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
              ⚠ Πολλαπλές επιστροφές
            </Badge>
          )}
          {data.lastOrderAt && (
            <span className="text-xs text-muted-foreground">
              Τελευταία: {new Date(data.lastOrderAt).toLocaleDateString('el-GR')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, warning }: { icon: React.ElementType; label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${warning ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/30'}`}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-heading font-bold text-sm mt-0.5">{value}</div>
    </div>
  );
}
