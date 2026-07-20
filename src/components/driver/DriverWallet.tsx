import { Wallet, ArrowDownCircle, ArrowUpCircle, Clock, TrendingUp, Banknote } from 'lucide-react';
import { useDriverWallet } from '@/hooks/useDriverWallet';

export function DriverWallet() {
  const { wallet, transactions, cashCollected, cashOutstanding, loading } = useDriverWallet();

  if (loading) {
    return (
      <div className="text-center py-16">
        <div className="h-8 w-8 border-4 border-[hsl(var(--driver-accent))] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-[hsl(var(--driver-text-muted))] font-heading text-sm">Φόρτωση...</p>
      </div>
    );
  }

  const balance = wallet?.available_balance ?? 0;
  const pending = wallet?.pending_balance ?? 0;
  const withdrawn = wallet?.total_withdrawn ?? 0;

  return (
    <div className="space-y-4">
      {/* Earnings card — credited instantly per delivery */}
      <div className="rounded-2xl driver-gradient-earn p-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-white/60" />
            <span className="text-white/60 text-[10px] font-heading uppercase tracking-[0.15em]">Κέρδη — Διαθέσιμα</span>
          </div>
        </div>
        <p className="font-heading font-extrabold text-4xl text-white tabular-nums">{balance.toFixed(2)}€</p>
        <div className="flex items-center gap-4 mt-2 text-xs text-white/50">
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Εκκρεμές: {pending.toFixed(2)}€</span>
          <span className="flex items-center gap-1"><Wallet className="h-3 w-3" />Αναλήψεις: {withdrawn.toFixed(2)}€</span>
        </div>
        <p className="text-[11px] text-white/60 mt-3 leading-relaxed">
          Πιστώνονται <strong>άμεσα</strong> με κάθε παράδοση. Αυτό είναι το διαθέσιμο υπόλοιπό σου για ανάληψη.
        </p>
      </div>


      {/* Transaction history */}
      <div className="rounded-2xl driver-glass overflow-hidden">
        <div className="px-4 py-3 border-b border-[hsl(var(--driver-border))]">
          <p className="font-heading font-bold text-sm text-[hsl(var(--driver-text))]">Ιστορικό Συναλλαγών</p>
        </div>
        <div className="divide-y divide-[hsl(var(--driver-border))]">
          {transactions.length === 0 ? (
            <p className="text-sm text-[hsl(var(--driver-text-muted))] text-center py-8">Δεν υπάρχουν συναλλαγές</p>
          ) : (
            transactions.map(tx => (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${
                  tx.type === 'earning_credit' ? 'bg-[hsl(var(--driver-accent))]/15' : 'bg-[hsl(var(--driver-surface))]'
                }`}>
                  {tx.type === 'earning_credit' ? (
                    <ArrowDownCircle className="h-4 w-4 text-[hsl(var(--driver-accent))]" />
                  ) : (
                    <ArrowUpCircle className="h-4 w-4 text-[hsl(var(--driver-text-muted))]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[hsl(var(--driver-text))] truncate">
                    {tx.type === 'earning_credit' ? 'Κέρδος παράδοσης' : 'Ανάληψη'}
                  </p>
                  <p className="text-[10px] text-[hsl(var(--driver-text-muted))]">
                    {new Date(tx.created_at).toLocaleDateString('el-GR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {tx.status === 'pending' && ' • Εκκρεμεί'}
                  </p>
                </div>
                <span className={`font-heading font-bold text-sm tabular-nums ${
                  tx.type === 'earning_credit' ? 'text-[hsl(var(--driver-accent))]' : 'text-[hsl(var(--driver-text-muted))]'
                }`}>
                  {tx.type === 'earning_credit' ? '+' : '-'}{Number(tx.amount).toFixed(2)}€
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
