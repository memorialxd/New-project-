import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { format, subDays, parseISO } from 'date-fns';

interface Order {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
}

interface Profile {
  id: string;
  created_at: string;
  role: string;
}

interface PlatformAnalyticsProps {
  orders: Order[];
  profiles: Profile[];
}

const STATUS_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(47, 100%, 50%)',
  'hsl(142, 76%, 36%)',
  'hsl(262, 83%, 58%)',
  'hsl(0, 84%, 60%)',
  'hsl(199, 89%, 48%)',
  'hsl(25, 95%, 53%)',
];

const statusLabelsEl: Record<string, string> = {
  pending: 'Εκκρεμεί',
  placed: 'Υποβλήθηκε',
  accepted: 'Αποδεκτή',
  preparing: 'Ετοιμάζεται',
  ready: 'Έτοιμη',
  picked_up: 'Παραλήφθηκε',
  delivered: 'Παραδόθηκε',
  cancelled: 'Ακυρώθηκε',
};

export default function PlatformAnalytics({ orders, profiles }: PlatformAnalyticsProps) {
  const { dailyRevenue, dailyOrders, userGrowth, statusPie } = useMemo(() => {
    const days = 30;
    const revenueMap = new Map<string, number>();
    const orderCountMap = new Map<string, number>();
    const userGrowthMap = new Map<string, number>();

    for (let i = days - 1; i >= 0; i--) {
      const key = format(subDays(new Date(), i), 'yyyy-MM-dd');
      revenueMap.set(key, 0);
      orderCountMap.set(key, 0);
      userGrowthMap.set(key, 0);
    }

    orders.forEach((o) => {
      const key = o.created_at.slice(0, 10);
      if (revenueMap.has(key)) {
        revenueMap.set(key, (revenueMap.get(key) ?? 0) + Number(o.total_amount));
        orderCountMap.set(key, (orderCountMap.get(key) ?? 0) + 1);
      }
    });

    profiles.forEach((p) => {
      const key = p.created_at.slice(0, 10);
      if (userGrowthMap.has(key)) {
        userGrowthMap.set(key, (userGrowthMap.get(key) ?? 0) + 1);
      }
    });

    let cumulative = profiles.filter(
      (p) => new Date(p.created_at) < subDays(new Date(), days)
    ).length;

    const userGrowthArr = Array.from(userGrowthMap.entries()).map(([date, count]) => {
      cumulative += count;
      return { date, label: format(parseISO(date), 'dd MMM'), users: cumulative, newUsers: count };
    });

    const dailyRevenue = Array.from(revenueMap.entries()).map(([date, revenue]) => ({
      date,
      label: format(parseISO(date), 'dd MMM'),
      revenue: Math.round(revenue * 100) / 100,
    }));

    const dailyOrders = Array.from(orderCountMap.entries()).map(([date, count]) => ({
      date,
      label: format(parseISO(date), 'dd MMM'),
      orders: count,
    }));

    const statusCount: Record<string, number> = {};
    orders.forEach((o) => {
      statusCount[o.status] = (statusCount[o.status] ?? 0) + 1;
    });
    const statusPie = Object.entries(statusCount).map(([name, value]) => ({ name: statusLabelsEl[name] ?? name, value }));

    return { dailyRevenue, dailyOrders, userGrowth: userGrowthArr, statusPie };
  }, [orders, profiles]);

  const revenueConfig = { revenue: { label: 'Έσοδα', color: 'hsl(var(--primary))' } };
  const ordersConfig = { orders: { label: 'Παραγγελίες', color: 'hsl(var(--accent))' } };
  const usersConfig = { users: { label: 'Σύνολο Χρηστών', color: 'hsl(var(--primary))' } };
  const statusConfig = Object.fromEntries(
    statusPie.map((s, i) => [s.name, { label: s.name, color: STATUS_COLORS[i % STATUS_COLORS.length] }])
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="font-heading text-base">Έσοδα (Τελευταίες 30 Ημέρες)</CardTitle></CardHeader>
        <CardContent>
          <ChartContainer config={revenueConfig} className="h-[250px] w-full">
            <AreaChart data={dailyRevenue}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `€${v}`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#revGrad)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="font-heading text-base">Τάσεις Παραγγελιών</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={ordersConfig} className="h-[220px] w-full">
              <BarChart data={dailyOrders}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="orders" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="font-heading text-base">Αύξηση Χρηστών</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={usersConfig} className="h-[220px] w-full">
              <LineChart data={userGrowth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="users" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="font-heading text-base">Κατανομή Κατάστασης Παραγγελιών</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center">
          <ChartContainer config={statusConfig} className="h-[250px] w-full max-w-md">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent />} />
              <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                {statusPie.map((_, i) => (
                  <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
