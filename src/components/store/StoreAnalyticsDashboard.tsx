import { DollarSign, ShoppingBag, Clock, TrendingUp, Star, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useStoreAnalytics } from '@/hooks/useStoreAnalytics';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { StoreRefunds } from './StoreRefunds';

interface StoreAnalyticsDashboardProps {
  storeId: string;
}

export function StoreAnalyticsDashboard({ storeId }: StoreAnalyticsDashboardProps) {
  const analytics = useStoreAnalytics(storeId);

  if (analytics.loading) {
    return (
      <div className="text-center py-16">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-muted-foreground font-heading">Φόρτωση στατιστικών...</p>
      </div>
    );
  }

  const chartData = analytics.dailyRevenue.map(d => ({
    day: new Date(d.date + 'T12:00:00').toLocaleDateString('el-GR', { weekday: 'short' }),
    revenue: Number(d.revenue.toFixed(2)),
    orders: d.orderCount,
  }));

  const statusLabels: Record<string, string> = {
    delivered: 'Παραδόθηκε',
    cancelled: 'Ακυρώθηκε',
    placed: 'Υποβλήθηκε',
    accepted: 'Αποδεκτή',
    preparing: 'Ετοιμάζεται',
    ready: 'Έτοιμη',
    picked_up: 'Παραλήφθηκε',
  };

  const statusColors: Record<string, string> = {
    delivered: 'bg-success',
    cancelled: 'bg-destructive',
    placed: 'bg-info',
    accepted: 'bg-info',
    preparing: 'bg-warning',
    ready: 'bg-primary',
    picked_up: 'bg-primary',
  };

  const totalOrders30d = Object.values(analytics.statusBreakdown).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card className="shadow-[var(--shadow-md)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-success" />
              <span className="text-xs text-muted-foreground font-heading">Σήμερα</span>
            </div>
            <p className="font-heading font-bold text-2xl text-foreground">€{analytics.todayRevenue.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{analytics.todayOrders} παραγγελίες</p>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-md)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground font-heading">Αυτή την Εβδομάδα</span>
            </div>
            <p className="font-heading font-bold text-2xl text-foreground">€{analytics.weekRevenue.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{analytics.weekOrders} παραγγελίες</p>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-md)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground font-heading">Μέσος Χρόνος</span>
            </div>
            <p className="font-heading font-bold text-2xl text-foreground">
              {analytics.avgPrepTime > 0 ? `${analytics.avgPrepTime} λεπ.` : '—'}
            </p>
            <p className="text-xs text-muted-foreground">ανά παραγγελία</p>
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-md)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-info" />
              <span className="text-xs text-muted-foreground font-heading">30 Ημέρες</span>
            </div>
            <p className="font-heading font-bold text-2xl text-foreground">{totalOrders30d}</p>
            <p className="text-xs text-muted-foreground">σύνολο παραγγελιών</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-[var(--shadow-md)]">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-lg">Ημερήσια Έσοδα (7 ημέρες)</CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.weekOrders === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Δεν υπάρχουν παραγγελίες αυτή την εβδομάδα</p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                  <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" tickFormatter={v => `€${v}`} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                    formatter={(value: number, name: string) => [
                      name === 'revenue' ? `€${value.toFixed(2)}` : value,
                      name === 'revenue' ? 'Έσοδα' : 'Παραγγελίες',
                    ]}
                  />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-md)]">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-lg flex items-center gap-2">
            <Star className="h-5 w-5 text-warning" />
            Δημοφιλή Προϊόντα
          </CardTitle>
        </CardHeader>
        <CardContent>
          {analytics.popularItems.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">Δεν υπάρχουν δεδομένα παραγγελιών</p>
          ) : (
            <div className="space-y-2">
              {analytics.popularItems.map((item, i) => {
                const maxQty = analytics.popularItems[0]?.quantity ?? 1;
                const pct = (item.quantity / maxQty) * 100;
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-heading font-bold text-muted-foreground w-5">{i + 1}</span>
                        <span className="text-sm font-heading text-foreground">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-muted-foreground">{item.quantity} πωλήσεις</span>
                        <span className="text-xs text-muted-foreground ml-2">€{item.revenue.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full gradient-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-[var(--shadow-md)]">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-lg">Κατάσταση Παραγγελιών (30 ημέρες)</CardTitle>
        </CardHeader>
        <CardContent>
          {totalOrders30d === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">Δεν υπάρχουν παραγγελίες</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(analytics.statusBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${statusColors[status] ?? 'bg-muted'}`} />
                      <span className="text-sm font-heading text-foreground">{statusLabels[status] ?? status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-heading font-semibold text-foreground">{count}</span>
                      <span className="text-xs text-muted-foreground w-10 text-right">
                        {((count / totalOrders30d) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      <StoreRefunds storeId={storeId} />
    </div>
  );
}
