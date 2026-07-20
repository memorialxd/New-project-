import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Minus, ShoppingBag, MapPin, Clock, Star, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCart } from '@/hooks/useCart';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';
import { ReviewList, RatingBadge } from '@/components/ReviewList';
import { FavoriteButton } from '@/components/customer/FavoriteButton';
import GroupOrderShare from '@/components/customer/GroupOrderShare';
import { MenuItemBadges } from '@/components/customer/MenuItemBadges';
import { SEO } from '@/components/SEO';

type StoreRow = Database['public']['Tables']['stores']['Row'];
type MenuItemRow = Database['public']['Tables']['menu_items']['Row'];

export default function RestaurantPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addItem, items, updateQuantity, itemCount, total, storeId: cartStoreId } = useCart();
  const [store, setStore] = useState<StoreRow | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showStickyHeader, setShowStickyHeader] = useState(false);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      (supabase as any).from('stores_public').select('*').eq('id', id).single(),
      supabase.from('menu_items').select('*').eq('store_id', id).eq('is_available', true).eq('is_snoozed', false).order('category').order('name'),
    ]).then(([storeRes, menuRes]) => {
      setStore(storeRes.data);
      setMenuItems(menuRes.data ?? []);
      setLoading(false);
    });
  }, [id]);

  const categories = [...new Set(menuItems.map(i => i.category ?? 'Άλλο'))];

  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  // Sticky header on scroll
  useEffect(() => {
    const handleScroll = () => {
      const heroHeight = heroRef.current?.offsetHeight ?? 200;
      setShowStickyHeader(window.scrollY > heroHeight - 60);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToCategory = (cat: string) => {
    setActiveCategory(cat);
    categoryRefs.current[cat]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const getItemQuantity = (menuItemId: string) => {
    const cartItem = items.find(i => i.menuItemId === menuItemId);
    return cartItem?.quantity ?? 0;
  };

  const handleAdd = (item: MenuItemRow) => {
    if (!store) return;
    if (cartStoreId && cartStoreId !== store.id) {
      toast('Το καλάθι εκκαθαρίστηκε — αλλαγή εστιατορίου', { duration: 3000 });
    }
    addItem(store.id, store.name, {
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
    });
    
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Skeleton */}
        <div className="h-56 bg-muted animate-pulse" />
        <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">
          <div className="h-7 bg-muted rounded w-2/3 animate-pulse" />
          <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
          <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
          <div className="mt-8 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!store) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-heading">Το εστιατόριο δεν βρέθηκε</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <SEO
        title={`${store.name} — Μενού & Παραγγελία | Fresh Delivery`}
        description={`Παραγγείλτε online από ${store.name}. Δείτε το μενού, τιμές και διαθεσιμότητα και απολαύστε γρήγορη παράδοση στην πόρτα σας.`}
        path={`/restaurant/${store.id}`}
        type="product"
        image={store.image_url ?? undefined}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Restaurant',
          name: store.name,
          image: store.image_url ?? undefined,
          address: store.address ?? undefined,
          url: `https://freshdelivery.app/restaurant/${store.id}`,
        }}
      />
      {/* Sticky Header (appears on scroll) */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 bg-card border-b border-border transition-all duration-200 ${
          showStickyHeader ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
        }`}
      >
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate('/order')}
            aria-label="Επιστροφή στη λίστα εστιατορίων"
            className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4 text-foreground" />
          </button>
          <span className="font-heading font-bold text-foreground text-sm truncate">{store.name}</span>
          {itemCount > 0 && cartStoreId === store.id && (
            <button
              onClick={() => navigate('/checkout')}
              className="ml-auto bg-primary text-primary-foreground rounded-full px-3 py-1 text-xs font-bold flex items-center gap-1"
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              {itemCount}
            </button>
          )}
        </div>
      </div>

      {/* Hero Image */}
      <header ref={heroRef} className="relative">
        <div className="h-64 bg-muted overflow-hidden">
          {store.image_url ? (
            <img src={store.image_url} alt={`Φωτογραφία εστιατορίου ${store.name}`} className="w-full h-full object-cover scale-105" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted">
              <span className="text-6xl">🍽️</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-black/30" />
        </div>
        {/* Back + Share buttons */}
        <button
          onClick={() => navigate('/order')}
          aria-label="Επιστροφή στη λίστα εστιατορίων"
          className="absolute top-4 left-4 h-10 w-10 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center shadow-sm"
        >
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <FavoriteButton storeId={store.id} size="md" />
          <button
            onClick={async () => {
              const url = window.location.href;
              const shareData = { title: store.name, text: `Δες το ${store.name} στο Fresh Delivery`, url };
              try {
                if (navigator.share) {
                  await navigator.share(shareData);
                } else {
                  await navigator.clipboard.writeText(url);
                  toast.success('Ο σύνδεσμος αντιγράφηκε');
                }
              } catch (e: any) {
                if (e?.name !== 'AbortError') toast.error('Δεν ήταν δυνατή η κοινοποίηση');
              }
            }}
            aria-label={`Κοινοποίηση εστιατορίου ${store.name}`}
            className="h-10 w-10 rounded-full bg-card/80 backdrop-blur-sm flex items-center justify-center shadow-sm active:scale-95 transition-transform"
          >
            <Share2 className="h-5 w-5 text-foreground" />
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-4">
        <h1 className="font-heading font-bold text-2xl text-foreground">{store.name}</h1>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <RatingBadge storeId={store.id} />
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {20 + (store.prep_buffer_minutes ?? 0)}-{35 + (store.prep_buffer_minutes ?? 0)} λεπ
          </span>
          <span className="text-sm text-muted-foreground">0,99€ παράδοση</span>
        </div>
        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1.5">
          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
          {store.address}
        </p>
        {store.busy_mode && (
          <div className="mt-3 bg-warning/10 border border-warning/20 rounded-lg px-3 py-2 text-xs text-warning font-medium flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Πολυάσχολο — αυξημένοι χρόνοι παράδοσης
          </div>
        )}
        <div className="mt-3">
          <GroupOrderShare storeId={store.id} />
        </div>
      </main>

      {/* Category Tabs (sticky under the floating header on scroll) */}
      {categories.length > 1 && (
        <div className={`sticky z-40 bg-card border-b border-border transition-all duration-200 ${
          showStickyHeader ? 'top-[52px]' : 'top-0'
        }`}>
          <div className="max-w-2xl mx-auto">
            <div className="flex overflow-x-auto no-scrollbar">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => scrollToCategory(cat)}
                  className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                    activeCategory === cat
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Menu Items */}
      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-8">
        {menuItems.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-heading text-foreground">Δεν υπάρχουν διαθέσιμα προϊόντα</p>
            <p className="text-sm text-muted-foreground mt-1">Ελέγξτε ξανά αργότερα</p>
          </div>
        ) : (
          categories.map(category => (
            <div
              key={category}
              ref={el => { categoryRefs.current[category] = el; }}
              className="scroll-mt-14"
            >
              <h2 className="font-heading font-bold text-lg text-foreground mb-3">{category}</h2>
              <div className="space-y-px divide-y divide-border">
                {menuItems.filter(i => (i.category ?? 'Άλλο') === category).map(item => {
                  const qty = getItemQuantity(item.id);
                  return (
                    <div
                      key={item.id}
                      className="flex gap-3 py-4 group"
                    >
                      {/* Text content */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-heading font-semibold text-foreground text-[15px]">{item.name}</h3>
                        {item.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{item.description}</p>
                        )}
                        <MenuItemBadges
                          isVegan={(item as any).is_vegan}
                          isVegetarian={(item as any).is_vegetarian}
                          isGlutenFree={(item as any).is_gluten_free}
                          spicyLevel={(item as any).spicy_level}
                          allergens={(item as any).allergens}
                          calories={(item as any).calories}
                        />
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-sm font-bold text-foreground">
                            {Number(item.price).toFixed(2)}€
                          </span>
                        </div>
                        {/* Add button for items without image */}
                        {!item.image_url && (
                          <div className="mt-2">
                            {qty > 0 ? (
                              <QuantityControl qty={qty} onMinus={() => updateQuantity(item.id, qty - 1)} onPlus={() => handleAdd(item)} />
                            ) : (
                              <button
                                onClick={() => handleAdd(item)}
                                className="h-8 px-4 rounded-full bg-muted hover:bg-muted/80 text-sm font-semibold text-foreground transition-colors flex items-center gap-1"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Προσθήκη
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Image + overlay add button */}
                      {item.image_url && (
                        <div className="relative flex-shrink-0">
                          <img
                            src={item.image_url}
                            alt={`Φωτογραφία ${item.name}`}
                            className="h-24 w-24 rounded-xl object-cover"
                          />
                          {/* Add button on image */}
                          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                            {qty > 0 ? (
                              <QuantityControl qty={qty} onMinus={() => updateQuantity(item.id, qty - 1)} onPlus={() => handleAdd(item)} compact />
                            ) : (
                              <button
                                onClick={() => handleAdd(item)}
                                className="h-8 w-8 rounded-full bg-card shadow-md border border-border flex items-center justify-center hover:bg-muted transition-colors"
                              >
                                <Plus className="h-4 w-4 text-primary" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* Reviews Section */}
        <div className="pt-4 pb-8">
          <h2 className="font-heading font-bold text-lg text-foreground mb-3">Κριτικές</h2>
          <ReviewList storeId={store.id} />
        </div>
      </div>

      {/* Floating Cart Bar */}
      {itemCount > 0 && cartStoreId === store.id && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-50">
          <div className="max-w-2xl mx-auto">
            <Button
              onClick={() => navigate('/checkout')}
              className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-heading text-base rounded-2xl shadow-lg flex items-center justify-between px-6"
            >
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-md bg-primary-foreground/20 flex items-center justify-center">
                  <span className="text-sm font-bold">{itemCount}</span>
                </div>
                <span>Προβολή Καλαθιού</span>
              </div>
              <span className="font-bold">{total.toFixed(2)}€</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuantityControl({ qty, onMinus, onPlus, compact }: { qty: number; onMinus: () => void; onPlus: () => void; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center bg-card rounded-full shadow-md border border-border overflow-hidden">
        <button onClick={onMinus} aria-label="Μείωση ποσότητας" className="h-7 w-7 flex items-center justify-center hover:bg-muted transition-colors">
          <Minus className="h-3 w-3 text-primary" />
        </button>
        <span className="text-xs font-bold text-foreground w-5 text-center" aria-live="polite">{qty}</span>
        <button onClick={onPlus} aria-label="Αύξηση ποσότητας" className="h-7 w-7 flex items-center justify-center hover:bg-muted transition-colors">
          <Plus className="h-3 w-3 text-primary" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onMinus}
        aria-label="Μείωση ποσότητας"
        className="h-8 w-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
      >
        <Minus className="h-3.5 w-3.5 text-foreground" />
      </button>
      <span className="font-heading font-bold text-foreground w-6 text-center text-sm" aria-live="polite">{qty}</span>
      <button
        onClick={onPlus}
        aria-label="Αύξηση ποσότητας"
        className="h-8 w-8 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
      >
        <Plus className="h-3.5 w-3.5 text-primary-foreground" />
      </button>
    </div>
  );
}
