import { Heart } from 'lucide-react';
import { useFavorites } from '@/hooks/useFavorites';
import { cn } from '@/lib/utils';

interface FavoriteButtonProps {
  storeId?: string;
  itemId?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function FavoriteButton({ storeId, itemId, className, size = 'md' }: FavoriteButtonProps) {
  const { isStoreFavorite, isItemFavorite, toggleStore, toggleItem } = useFavorites();
  const active = storeId ? isStoreFavorite(storeId) : itemId ? isItemFavorite(itemId) : false;

  const sizes = {
    sm: { btn: 'h-7 w-7', icon: 'h-3.5 w-3.5' },
    md: { btn: 'h-9 w-9', icon: 'h-4 w-4' },
    lg: { btn: 'h-10 w-10', icon: 'h-5 w-5' },
  }[size];

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (storeId) toggleStore(storeId);
        else if (itemId) toggleItem(itemId);
      }}
      className={cn(
        'rounded-full flex items-center justify-center transition-all active:scale-90',
        active
          ? 'bg-red-500/15 text-red-500 hover:bg-red-500/25'
          : 'bg-card/90 backdrop-blur-sm text-muted-foreground hover:text-red-500 shadow-sm border border-border',
        sizes.btn,
        className,
      )}
      aria-label={active ? 'Αφαίρεση αγαπημένου' : 'Προσθήκη στα αγαπημένα'}
    >
      <Heart className={cn(sizes.icon, active && 'fill-current')} />
    </button>
  );
}
