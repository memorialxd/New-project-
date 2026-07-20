import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type OrderRow = Database['public']['Tables']['orders']['Row'];
type OrderItemRow = Database['public']['Tables']['order_items']['Row'];

interface DailyRevenue {
  date: string;
  revenue: number;
  orderCount: number;
}

interface PopularItem {
  name: string;
  quantity: number;
  revenue: number;
}

export interface StoreAnalyticsData {
  todayRevenue: number;
  todayOrders: number;
  weekRevenue: number;
  weekOrders: number;
  avgPrepTime: number;
  dailyRevenue: DailyRevenue[];
  popularItems: PopularItem[];
  statusBreakdown: Record<string, number>;
  loading: boolean;
}

export function useStoreAnalytics(storeId: string | null): StoreAnalyticsData {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storeId) return;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    Promise.all([
      supabase
        .from('orders')
        .select('*')
        .eq('store_id', storeId)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false }),
      supabase
        .from('order_items')
        .select('*, orders!inner(store_id, created_at)')
        .eq('orders.store_id', storeId)
        .gte('orders.created_at', thirtyDaysAgo.toISOString()),
    ]).then(([ordersRes, itemsRes]) => {
      setOrders((ordersRes.data ?? []) as OrderRow[]);
      setOrderItems((itemsRes.data ?? []) as OrderItemRow[]);
      setLoading(false);
    });
  }, [storeId]);

  return useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Today
    const todayOrders = orders.filter(o => o.created_at.slice(0, 10) === todayStr);
    const todayRevenue = todayOrders.reduce((s, o) => s + Number(o.total_amount), 0);

    // This week
    const weekOrders = orders.filter(o => new Date(o.created_at) >= sevenDaysAgo);
    const weekRevenue = weekOrders.reduce((s, o) => s + Number(o.total_amount), 0);

    // Avg prep time (from delivered orders that have estimated_prep_time)
    const deliveredWithPrep = orders.filter(o => o.status === 'delivered' && o.estimated_prep_time);
    const avgPrepTime = deliveredWithPrep.length > 0
      ? deliveredWithPrep.reduce((s, o) => s + (o.estimated_prep_time ?? 0), 0) / deliveredWithPrep.length
      : 0;

    // Daily revenue (last 7 days)
    const dailyMap = new Map<string, DailyRevenue>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, { date: key, revenue: 0, orderCount: 0 });
    }
    weekOrders.forEach(o => {
      const key = o.created_at.slice(0, 10);
      const entry = dailyMap.get(key);
      if (entry) {
        entry.revenue += Number(o.total_amount);
        entry.orderCount++;
      }
    });
    const dailyRevenue = Array.from(dailyMap.values());

    // Popular items
    const itemMap = new Map<string, PopularItem>();
    orderItems.forEach(item => {
      const existing = itemMap.get(item.name) ?? { name: item.name, quantity: 0, revenue: 0 };
      existing.quantity += item.quantity;
      existing.revenue += Number(item.unit_price) * item.quantity;
      itemMap.set(item.name, existing);
    });
    const popularItems = Array.from(itemMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8);

    // Status breakdown
    const statusBreakdown: Record<string, number> = {};
    orders.forEach(o => {
      statusBreakdown[o.status] = (statusBreakdown[o.status] ?? 0) + 1;
    });

    return {
      todayRevenue,
      todayOrders: todayOrders.length,
      weekRevenue,
      weekOrders: weekOrders.length,
      avgPrepTime: Math.round(avgPrepTime),
      dailyRevenue,
      popularItems,
      statusBreakdown,
      loading,
    };
  }, [orders, orderItems, loading]);
}
