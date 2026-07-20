import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { geocodeAddress } from '@/lib/geocode';
import type { Database } from '@/integrations/supabase/types';

type StoreRow = Database['public']['Tables']['stores']['Row'];

export function useStore() {
  const { user } = useAuth();
  const [store, setStore] = useState<StoreRow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStore = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', user.id)
      .maybeSingle();

    setStore(data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchStore();
  }, [fetchStore]);

  const createStore = async (storeData: { name: string; address: string; phone?: string }) => {
    if (!user) return null;

    // Best-effort geocode at creation so the store appears on driver/admin maps
    // immediately. Silently ignored if Mapbox can't resolve the address.
    let geo: { latitude: number; longitude: number } | null = null;
    if (storeData.address) {
      const res = await geocodeAddress(storeData.address);
      if (res) geo = { latitude: res.latitude, longitude: res.longitude };
    }

    const { data, error } = await supabase
      .from('stores')
      .insert({ ...storeData, ...(geo ?? {}), owner_id: user.id })
      .select()
      .single();

    if (error) {
      toast.error('Failed to create store');
      return null;
    }
    toast.success('Store created!');
    setStore(data);
    return data;
  };

  const updateStore = async (updates: Partial<Pick<StoreRow, 'is_active' | 'busy_mode' | 'prep_buffer_minutes' | 'name' | 'address' | 'phone' | 'image_url'>>) => {
    if (!store) return;

    // If the address changed, re-geocode so map markers stay correct.
    let coordPatch: { latitude?: number; longitude?: number } = {};
    if (updates.address && updates.address !== store.address) {
      const res = await geocodeAddress(updates.address);
      if (res) coordPatch = { latitude: res.latitude, longitude: res.longitude };
    }

    const payload = { ...updates, ...coordPatch };
    const { error } = await supabase
      .from('stores')
      .update(payload)
      .eq('id', store.id);

    if (error) {
      toast.error('Failed to update store');
    } else {
      setStore(prev => prev ? { ...prev, ...payload } : prev);
      toast.success('Store updated');
    }
  };

  return { store, loading, createStore, updateStore, refetch: fetchStore };
}
