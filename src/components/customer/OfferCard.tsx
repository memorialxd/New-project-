import { Bike, Plus, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '@/hooks/useCart';
import { toast } from 'sonner';

export interface OfferItem {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  store_id: string;
  store_name: string;
  store_image_url: string | null;
  store_prep_buffer_minutes?: number | null;
  store_rating_avg?: number;
  store_rating_count?: number;
  delivery_fee?: number;
  /** Optional original price for strikethrough effect */
  original_price?: number | null;
  /** Optional small badge text under the price, e.g. "1+1 Προσφορά" */
  badge?: string | null;
  /** Optional red sticker (top-right of image), e.g. "Meal for one" */
  sticker?: string | null;
}

/**
 * efood-inspired offer card. Image with floating "+" + delivery chip on top,
 * price + optional strikethrough below, store footer with rating & ETA.
 * Tapping the card opens the store; tapping "+" adds the item to cart.
 */
export function OfferCard({ item, variant = 'default' }: { item: OfferItem; variant?: 'default' | 'wide' }) {
  const navigate = useNavigate();
  const { addItem, storeId: cartStoreId } = useCart();

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cartStoreId && cartStoreId !== item.store_id) {
      toast('Το καλάθι εκκαθαρίστηκε — αλλαγή εστιατορίου', { duration: 2400 });
    }
    addItem(item.store_id, item.store_name, {
      menuItemId: item.id,
      name: item.name,
      price: Number(item.price),
    });
  };

  const fee = item.delivery_fee ?? 0.99;
  const feeLabel = fee === 0 ? 'Δωρεάν' : `${fee.toFixed(2).replace('.', ',')}€`;
  const eta = (item.store_prep_buffer_minutes ?? 0);

  return (
    <button
      onClick={() => navigate(`/restaurant/${item.store_id}`)}
      className={`group relative text-left shrink-0 ${variant === 'wide' ? 'w-[230px]' : 'w-[180px]'} bg-white rounded-2xl overflow-hidden border border-[hsl(0,0%,93%)] shadow-[0_1px_2px_-1px_hsl(0_0%_0%/0.06),0_10px_24px_-14px_hsl(0_0%_0%/0.18)] hover:shadow-[0_4px_8px_-2px_hsl(0_0%_0%/0.08),0_18px_36px_-12px_hsl(0_0%_0%/0.22)] transition-shadow duration-300`}
    >
      {/* Image */}
      <div className={`relative ${variant === 'wide' ? 'aspect-[5/4]' : 'aspect-square'} bg-[hsl(0,0%,96%)] overflow-hidden`}>
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={`Φωτογραφία ${item.name}`}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500 ease-out"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl emoji">🍽️</div>
        )}

        {/* + button (top-right) */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`Προσθήκη ${item.name} στο καλάθι`}
          onClick={handleAdd}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleAdd(e as any); }}
          className="absolute top-2 right-2 h-9 w-9 rounded-xl bg-white shadow-[0_2px_6px_-1px_hsl(0_0%_0%/0.18)] flex items-center justify-center active:scale-90 transition-transform hover:bg-[hsl(0,0%,98%)]"
        >
          <Plus className="h-4 w-4 text-[hsl(0,0%,9%)]" strokeWidth={2.8} />
        </div>

        {/* Delivery chip (bottom-left) */}
        <div className="absolute bottom-2 left-2 bg-white/95 backdrop-blur rounded-full pl-1.5 pr-2 py-1 flex items-center gap-1 shadow-[0_1px_3px_hsl(0_0%_0%/0.12)]">
          <Bike className="h-3 w-3 c-accent" strokeWidth={2.6} />
          <span className="text-[10px] font-extrabold text-[hsl(0,0%,9%)]">{feeLabel}</span>
        </div>

        {/* Optional red sticker (top-left, slightly rotated) */}
        {item.sticker && (
          <div className="absolute top-2 left-2 -rotate-6">
            <div className="bg-[hsl(0,75%,52%)] text-white text-[9px] font-black uppercase leading-tight px-2 py-1 rounded-md shadow-[0_2px_6px_-1px_hsl(0_75%_45%/0.5)] tracking-wide text-center">
              {item.sticker}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-2.5 space-y-1.5">
        <p className="text-[12.5px] font-bold text-[hsl(0,0%,9%)] leading-tight line-clamp-2 min-h-[2.2em]">
          {item.name}
        </p>

        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-extrabold text-[hsl(0,0%,9%)] tabular-nums">
            {Number(item.price).toFixed(2).replace('.', ',')}€
          </span>
          {item.original_price && item.original_price > item.price && (
            <span className="text-[11px] font-semibold c-muted line-through tabular-nums">
              {Number(item.original_price).toFixed(2).replace('.', ',')}€
            </span>
          )}
        </div>

        {item.badge && (
          <div className="inline-flex items-center bg-[hsl(0,75%,96%)] text-[hsl(0,75%,45%)] text-[10px] font-extrabold px-1.5 py-0.5 rounded">
            {item.badge}
          </div>
        )}

        {/* Footer: store */}
        <div className="pt-1.5 mt-1 border-t border-[hsl(0,0%,94%)] flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-full bg-[hsl(0,0%,94%)] flex items-center justify-center overflow-hidden shrink-0">
            {item.store_image_url ? (
              <img src={item.store_image_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[9px] emoji">🍽️</span>
            )}
          </div>
          <span className="text-[10.5px] font-bold text-[hsl(0,0%,9%)] truncate flex-1">{item.store_name}</span>
          {item.store_rating_avg && item.store_rating_avg > 0 && (
            <span className="text-[10px] font-bold text-[hsl(150,55%,38%)] flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-current" strokeWidth={0} />
              {item.store_rating_avg.toFixed(1)}
            </span>
          )}
        </div>
        {eta > 0 && (
          <p className="text-[10px] c-muted font-semibold tabular-nums">
            {20 + eta}′–{35 + eta}′
          </p>
        )}
      </div>
    </button>
  );
}
