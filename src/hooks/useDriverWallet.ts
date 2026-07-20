import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface WalletData {
  available_balance: number;
  pending_balance: number;
  total_withdrawn: number;
}

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  description: string | null;
  created_at: string;
}

interface CashDebt {
  id: string;
  order_id: string;
  cash_collected: number;
  amount_owed: number;
  settled: boolean;
  created_at: string;
}

export function useDriverWallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [cashDebts, setCashDebts] = useState<CashDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [cashingOut, setCashingOut] = useState(false);

  const fetchWallet = useCallback(async () => {
    if (!user) return;
    const [walletRes, txRes, cashRes] = await Promise.all([
      supabase.from('driver_wallets').select('available_balance, pending_balance, total_withdrawn').eq('driver_id', user.id).maybeSingle(),
      supabase.from('wallet_transactions').select('*').eq('driver_id', user.id).order('created_at', { ascending: false }).limit(20),
      (supabase as any).from('driver_cash_debts').select('id, order_id, cash_collected, amount_owed, settled, created_at').eq('driver_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]);
    if (walletRes.data) setWallet(walletRes.data);
    if (txRes.data) setTransactions(txRes.data as WalletTransaction[]);
    if (cashRes.data) setCashDebts(cashRes.data as CashDebt[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  // Realtime subscription for wallet updates
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`driver-wallet-${user.id}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_wallets', filter: `driver_id=eq.${user.id}` }, () => fetchWallet())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'wallet_transactions', filter: `driver_id=eq.${user.id}` }, () => fetchWallet())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_cash_debts', filter: `driver_id=eq.${user.id}` }, () => fetchWallet())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchWallet]);

  const cashOut = useCallback(async (amount: number) => {
    if (!user) return { error: 'Not authenticated' };
    setCashingOut(true);
    try {
      const { error } = await supabase.rpc('request_wallet_withdrawal', {
        p_driver_id: user.id,
        p_amount: amount,
      });
      if (error) throw error;
      await fetchWallet();
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Cash out failed' };
    } finally {
      setCashingOut(false);
    }
  }, [user, fetchWallet]);

  const cashCollected = cashDebts.reduce((sum, d) => sum + Number(d.cash_collected ?? 0), 0);
  const cashOutstanding = cashDebts.filter(d => !d.settled).reduce((sum, d) => sum + Number(d.amount_owed ?? d.cash_collected ?? 0), 0);

  return { wallet, transactions, cashDebts, cashCollected, cashOutstanding, loading, cashOut, cashingOut, refetch: fetchWallet };
}
