import { useState, useEffect, useRef } from 'react';
import { Store, ClipboardList, UtensilsCrossed, Settings, Plus, Bell, BarChart3, Tag, Package, Clock, Zap, PackagePlus, Wallet } from 'lucide-react';
import { UserMenu } from '@/components/UserMenu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrderQueue } from '@/components/store/OrderQueue';
import { MenuControl } from '@/components/store/MenuControl';
import { StoreSettings } from '@/components/store/StoreSettings';
import { PrinterSettings } from '@/components/store/PrinterSettings';
import { StoreAnalyticsDashboard } from '@/components/store/StoreAnalyticsDashboard';
import { PromoManager } from '@/components/store/PromoManager';
import { InventoryControl } from '@/components/store/InventoryControl';
import { StoreHoursManager } from '@/components/store/StoreHoursManager';
import AutoAcceptRules from '@/components/store/AutoAcceptRules';
import StoreExternalOrderIngest from '@/components/store/StoreExternalOrderIngest';
import StoreWalletCard from '@/components/store/StoreWalletCard';
import { StoreSupportButton } from '@/components/store/StoreSupportButton';
import { StoreDailyGoalCard } from '@/components/store/StoreDailyGoalCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStoreOrders } from '@/hooks/useOrders';
import { useStore } from '@/hooks/useStore';
import { requestNotificationPermission } from '@/lib/notifications';
import AnnouncementsBanner from '@/components/AnnouncementsBanner';

export default function StoreApp() {
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  );

  const handleEnableNotifications = async () => {
    const granted = await requestNotificationPermission();
    setNotifPermission(granted ? 'granted' : 'denied');
  };
  const { store, loading: storeLoading, createStore } = useStore();
  const { orders, loading: ordersLoading, updateOrderStatus } = useStoreOrders(store?.id ?? null);
  const [newStore, setNewStore] = useState({ name: '', address: '', phone: '' });
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState('orders');
  const tabsListRef = useRef<HTMLDivElement>(null);

  // Keep the active tab visible inside the horizontally scrolling tab strip on mobile.
  useEffect(() => {
    const list = tabsListRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(`[data-state="active"]`);
    if (active) {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeTab]);

  const newOrders = orders.filter(o => o.status === 'placed').length;
  const loading = storeLoading || ordersLoading;

  const handleCreateStore = async () => {
    if (!newStore.name || !newStore.address) return;
    setCreating(true);
    await createStore(newStore);
    setCreating(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-2">
          <Store className="h-6 w-6 text-primary" />
          <h1 className="font-heading font-bold text-lg text-foreground">DashStore</h1>
        </div>
        <div className="flex items-center gap-2">
          {store && (
            <Badge variant="outline" className={`font-heading ${store.is_active ? 'text-success border-success/30' : 'text-muted-foreground border-border'}`}>
              {store.is_active ? '● Ανοιχτό' : '○ Κλειστό'}
            </Badge>
          )}
          {newOrders > 0 && (
            <Badge className="gradient-primary text-primary-foreground font-heading">
              {newOrders} νέες
            </Badge>
          )}
          {store && <StoreSupportButton />}
          <UserMenu />
        </div>
      </header>

      <div className="p-4 max-w-2xl mx-auto">
        {storeLoading ? (
          <div className="text-center py-16">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground font-heading">Φόρτωση...</p>
          </div>
        ) : !store ? (
          <div className="max-w-md mx-auto py-8">
            <Card className="shadow-[var(--shadow-lg)]">
              <CardContent className="p-6 space-y-4">
                <div className="text-center mb-4">
                  <div className="h-16 w-16 rounded-2xl gradient-primary shadow-primary flex items-center justify-center mx-auto mb-3">
                    <Plus className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <h2 className="font-heading font-bold text-xl text-foreground">Ρύθμιση Καταστήματος</h2>
                  <p className="text-sm text-muted-foreground mt-1">Δημιουργήστε το προφίλ του εστιατορίου σας για να αρχίσετε να δέχεστε παραγγελίες</p>
                </div>
                <div>
                  <Label className="font-heading">Όνομα Καταστήματος</Label>
                  <Input value={newStore.name} onChange={e => setNewStore(p => ({ ...p, name: e.target.value }))} placeholder="π.χ. Πιτσαρία Μάριος" maxLength={100} />
                </div>
                <div>
                  <Label className="font-heading">Διεύθυνση</Label>
                  <Input value={newStore.address} onChange={e => setNewStore(p => ({ ...p, address: e.target.value }))} placeholder="Οδός 123, Πόλη" maxLength={200} />
                </div>
                <div>
                  <Label className="font-heading">Τηλέφωνο (προαιρετικό)</Label>
                  <Input value={newStore.phone} onChange={e => setNewStore(p => ({ ...p, phone: e.target.value }))} placeholder="210 1234567" maxLength={20} />
                </div>
                <Button
                  onClick={handleCreateStore}
                  className="w-full h-12 font-heading text-lg gradient-primary shadow-primary text-primary-foreground"
                  disabled={!newStore.name || !newStore.address || creating}
                >
                  {creating ? 'Δημιουργία...' : 'Δημιουργία Καταστήματος'}
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            {notifPermission === 'default' && (
              <div className="mb-4 flex items-center gap-3 p-3 rounded-xl bg-info/10 border border-info/20">
                <Bell className="h-5 w-5 text-info flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-heading font-semibold text-foreground">Ενεργοποίηση ειδοποιήσεων</p>
                  <p className="text-xs text-muted-foreground">Λάβετε ηχητικές ειδοποιήσεις όταν φτάνουν νέες παραγγελίες</p>
                </div>
                <Button size="sm" onClick={handleEnableNotifications} className="gradient-primary text-primary-foreground font-heading">
                  Ενεργοποίηση
                </Button>
              </div>
            )}
            <AnnouncementsBanner audience="store_owners" />
            <div className="mb-4">
              <StoreDailyGoalCard storeId={store.id} />
            </div>
            <Button
              onClick={() => setActiveTab('external')}
              className="w-full mb-4 h-12 gradient-primary text-primary-foreground font-heading gap-2 sm:hidden"
            >
              <PackagePlus className="h-4 w-4" />
              Νέα Custom Order (eFood / Wolt / Box)
            </Button>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList ref={tabsListRef} className="w-full mb-4 h-auto gap-1 flex overflow-x-auto sm:flex-wrap scrollbar-thin">
              <TabsTrigger value="orders" className="flex-1 min-w-[90px] font-heading relative">
                <ClipboardList className="h-4 w-4 mr-1.5" />
                Παραγγελίες
                {newOrders > 0 && (
                  <Badge className="ml-1.5 h-5 w-5 p-0 flex items-center justify-center gradient-primary text-primary-foreground text-xs">
                    {newOrders}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="external" className="flex-1 min-w-[110px] font-heading">
                <PackagePlus className="h-4 w-4 mr-1.5" />
                Custom Order
              </TabsTrigger>
              <TabsTrigger value="menu" className="flex-1 min-w-[80px] font-heading">
                <UtensilsCrossed className="h-4 w-4 mr-1.5" />
                Μενού
              </TabsTrigger>
              <TabsTrigger value="inventory" className="flex-1 min-w-[90px] font-heading">
                <Package className="h-4 w-4 mr-1.5" />
                Απόθεμα
              </TabsTrigger>
              <TabsTrigger value="hours" className="flex-1 min-w-[80px] font-heading">
                <Clock className="h-4 w-4 mr-1.5" />
                Ωράριο
              </TabsTrigger>
              <TabsTrigger value="analytics" className="flex-1 min-w-[90px] font-heading">
                <BarChart3 className="h-4 w-4 mr-1.5" />
                Στατιστικά
              </TabsTrigger>
              <TabsTrigger value="wallet" className="flex-1 min-w-[90px] font-heading">
                <Wallet className="h-4 w-4 mr-1.5" />
                Πορτοφόλι
              </TabsTrigger>
              <TabsTrigger value="promos" className="flex-1 min-w-[90px] font-heading">
                <Tag className="h-4 w-4 mr-1.5" />
                Προσφορές
              </TabsTrigger>
              <TabsTrigger value="automation" className="flex-1 min-w-[90px] font-heading">
                <Zap className="h-4 w-4 mr-1.5" />
                Auto
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1 min-w-[90px] font-heading">
                <Settings className="h-4 w-4 mr-1.5" />
                Ρυθμίσεις
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orders">
              {loading ? (
                <div className="text-center py-16">
                  <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-muted-foreground font-heading">Φόρτωση παραγγελιών...</p>
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-16">
                  <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="font-heading text-foreground">Δεν υπάρχουν ενεργές παραγγελίες</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Νέες παραγγελίες θα εμφανιστούν εδώ σε πραγματικό χρόνο
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-success">
                    <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                    Αναμονή για παραγγελίες...
                  </div>
                </div>
              ) : (
                <OrderQueue orders={orders} onStatusUpdate={updateOrderStatus} storeName={store.name} />
              )}
            </TabsContent>

            <TabsContent value="external">
              <StoreExternalOrderIngest storeId={store.id} />
            </TabsContent>

            <TabsContent value="menu">
              <MenuControl storeId={store.id} />
            </TabsContent>

            <TabsContent value="inventory">
              <InventoryControl storeId={store.id} />
            </TabsContent>

            <TabsContent value="hours">
              <StoreHoursManager storeId={store.id} />
            </TabsContent>

            <TabsContent value="analytics">
              <StoreAnalyticsDashboard storeId={store.id} />
            </TabsContent>

            <TabsContent value="wallet">
              <StoreWalletCard storeId={store.id} />
            </TabsContent>

            <TabsContent value="promos">
              <PromoManager storeId={store.id} />
            </TabsContent>

            <TabsContent value="automation">
              <AutoAcceptRules storeId={store.id} />
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <StoreSettings storeId={store.id} />
              <PrinterSettings storeName={store.name} />
            </TabsContent>
          </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
