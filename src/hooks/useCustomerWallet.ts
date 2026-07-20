import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface WalletEntry {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

export function useCustomerWallet() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [lifetime, setLifetime] = useState(0);
  const [history, setHistory] = useState<WalletEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!user) {
      setBalance(0);
      setHistory([]);
      setLoading(false);
      return;
    }
    const [walletRes, ledgerRes] = await Promise.all([
      supabase.from('customer_wallets').select('balance, lifetime_credit').eq('user_id', user.id).maybeSingle(),
      supabase.from('customer_wallet_ledger').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]);
    setBalance(Number(walletRes.data?.balance ?? 0));
    setLifetime(Number(walletRes.data?.lifetime_credit ?? 0));
    setHistory((ledgerRes.data ?? []) as WalletEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    if (!user) return;
    const ch = supabase
      .channel(`wallet-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_wallets', filter: `user_id=eq.${user.id}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { balance, lifetime, history, loading, refresh };
}
