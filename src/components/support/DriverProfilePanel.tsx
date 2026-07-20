import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  User, Phone, Mail, Car, IdCard, Calendar, MapPin, AlertCircle,
  Wallet, TrendingUp, Hash, Languages, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

export function DriverProfilePanel({ driverId }: { driverId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['support-driver-profile', driverId],
    queryFn: async () => {
      const [profileRes, driverRes, walletRes, statsRes, openTicketsRes] = await Promise.all([
        supabase.from('profiles').select('full_name, phone, avatar_url, created_at').eq('user_id', driverId).maybeSingle(),
        supabase.from('driver_profiles').select('*').eq('user_id', driverId).maybeSingle(),
        supabase.from('driver_wallets').select('available_balance, pending_balance, total_withdrawn').eq('driver_id', driverId).maybeSingle(),
        supabase.from('orders').select('id, status', { count: 'exact', head: false }).eq('driver_id', driverId),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('driver_id', driverId).neq('status', 'resolved'),
      ]);
      const orders = statsRes.data ?? [];
      const delivered = orders.filter((o: any) => o.status === 'delivered').length;
      return {
        profile: profileRes.data,
        driver: driverRes.data,
        wallet: walletRes.data,
        totalOrders: orders.length,
        deliveredOrders: delivered,
        openTickets: openTicketsRes.count ?? 0,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const p = data?.profile;
  const d = data?.driver;
  const w = data?.wallet;

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center gap-3 pb-3 border-b">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            {p?.avatar_url ? (
              <img src={p.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <User className="h-6 w-6" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-heading font-bold text-sm truncate">{p?.full_name ?? 'Άγνωστο'}</p>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {d?.driver_code ?? (driverId ? driverId.slice(0, 8) : '—')}
            </p>
          </div>
          <div className="flex flex-col gap-1 items-end">
            {d?.is_active ? (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                Ενεργός
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">
                Ανενεργός
              </Badge>
            )}
            {d?.suspended_at && (
              <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-700 border-red-500/30">
                Σε αναστολή
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-[9px] uppercase text-muted-foreground">Παραδόσεις</p>
            <p className="font-heading font-bold text-sm">{data?.deliveredOrders ?? 0}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-[9px] uppercase text-muted-foreground">Πορτοφόλι</p>
            <p className="font-heading font-bold text-sm">{(w?.available_balance ?? 0).toFixed(2)}€</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2">
            <p className="text-[9px] uppercase text-muted-foreground">Tickets</p>
            <p className="font-heading font-bold text-sm">{data?.openTickets ?? 0}</p>
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          {p?.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <a href={`tel:${p.phone}`} className="text-primary hover:underline">{p.phone}</a>
              {d?.secondary_phone && (
                <span className="text-muted-foreground">· 2ο: {d.secondary_phone}</span>
              )}
            </div>
          )}
          {(d?.vehicle_type || d?.vehicle_make) && (
            <div className="flex items-center gap-2">
              <Car className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>
                {[d?.vehicle_type, d?.vehicle_make, d?.vehicle_model, d?.vehicle_color].filter(Boolean).join(' · ')}
                {d?.license_plate && ` · ${d.license_plate}`}
              </span>
            </div>
          )}
          {d?.license_number && (
            <div className="flex items-center gap-2">
              <IdCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>Άδεια: {d.license_number}</span>
              {d?.license_expiry && (
                <span className="text-muted-foreground">· λήξη {format(new Date(d.license_expiry), 'dd/MM/yy')}</span>
              )}
            </div>
          )}
          {d?.home_address && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{d.home_address}</span>
            </div>
          )}
          {d?.emergency_contact_name && (
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
              <span>
                SOS: {d.emergency_contact_name}
                {d?.emergency_contact_phone && (
                  <a href={`tel:${d.emergency_contact_phone}`} className="text-primary hover:underline ml-1">
                    {d.emergency_contact_phone}
                  </a>
                )}
              </span>
            </div>
          )}
          {d?.languages && d.languages.length > 0 && (
            <div className="flex items-center gap-2">
              <Languages className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>{d.languages.join(', ')}</span>
            </div>
          )}
          {p?.created_at && (
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">
                Εγγραφή: {format(new Date(p.created_at), 'dd MMM yyyy')}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
