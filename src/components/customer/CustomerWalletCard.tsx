import { Card, CardContent } from '@/components/ui/card';
import { Ticket, ArrowDownCircle, ArrowUpCircle, Gift } from 'lucide-react';
import { useCustomerWallet } from '@/hooks/useCustomerWallet';

export function CustomerWalletCard() {
  const { balance, lifetime, history, loading } = useCustomerWallet();

  if (loading) return null;
  if (balance === 0 && lifetime === 0 && history.length === 0) return null;

  return (
    <Card className="shadow-[var(--shadow-md)] border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            <span className="font-heading font-semibold text-foreground">Κουπόνια</span>
          </div>
          <span className="font-heading font-bold text-2xl text-foreground">
            {balance.toFixed(2)}€
          </span>
        </div>
        {lifetime > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Συνολικά: {lifetime.toFixed(2)}€
          </p>
        )}
        {history.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border">
            {history.slice(0, 5).map(h => (
              <div key={h.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  {h.type === 'referral_bonus' ? <Gift className="h-3 w-3 text-success shrink-0" /> :
                   h.amount > 0 ? <ArrowDownCircle className="h-3 w-3 text-success shrink-0" /> :
                   <ArrowUpCircle className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="text-muted-foreground truncate">{h.description ?? h.type}</span>
                </div>
                <span className={`font-heading font-bold tabular-nums ${h.amount > 0 ? 'text-success' : 'text-foreground'}`}>
                  {h.amount > 0 ? '+' : ''}{h.amount.toFixed(2)}€
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
