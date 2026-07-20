import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface FavoriteRow {
  id: string;
  store_id: string | null;
  menu_item_id: string | null;
}

export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFavorites = useCallback(async () => {
    if (!user) {
      setFavorites([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('customer_favorites' as any)
      .select('id, store_id, menu_item_id')
      .eq('user_id', user.id);
    setFavorites((data ?? []) as any);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const isStoreFavorite = (storeId: string) =>
    favorites.some((f) => f.store_id === storeId);
  const isItemFavorite = (itemId: string) =>
    favorites.some((f) => f.menu_item_id === itemId);

  const toggleStore = async (storeId: string) => {
    if (!user) {
      toast.error('Συνδεθείτε για να αποθηκεύσετε αγαπημένα');
      return;
    }
    const existing = favorites.find((f) => f.store_id === storeId);
    if (existing) {
      const { error } = await supabase
        .from('customer_favorites' as any)
        .delete()
        .eq('id', existing.id);
      if (!error) {
        setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
      }
    } else {
      const { data, error } = await supabase
        .from('customer_favorites' as any)
        .insert({ user_id: user.id, store_id: storeId, menu_item_id: null } as any)
        .select('id, store_id, menu_item_id')
        .single();
      if (!error && data) {
        setFavorites((prev) => [...prev, data as any]);
        toast.success('Προστέθηκε στα αγαπημένα ❤️');
      }
    }
  };

  const toggleItem = async (itemId: string) => {
    if (!user) {
      toast.error('Συνδεθείτε για να αποθηκεύσετε αγαπημένα');
      return;
    }
    const existing = favorites.find((f) => f.menu_item_id === itemId);
    if (existing) {
      const { error } = await supabase
        .from('customer_favorites' as any)
        .delete()
        .eq('id', existing.id);
      if (!error) {
        setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
      }
    } else {
      const { data, error } = await supabase
        .from('customer_favorites' as any)
        .insert({ user_id: user.id, store_id: null, menu_item_id: itemId } as any)
        .select('id, store_id, menu_item_id')
        .single();
      if (!error && data) {
        setFavorites((prev) => [...prev, data as any]);
        toast.success('Προστέθηκε στα αγαπημένα ❤️');
      }
    }
  };

  return {
    favorites,
    loading,
    isStoreFavorite,
    isItemFavorite,
    toggleStore,
    toggleItem,
    refetch: fetchFavorites,
  };
}
