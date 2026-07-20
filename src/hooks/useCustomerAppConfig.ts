import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type HeroCard = {
  id: string;
  title: string;
  subtitle?: string;
  cta_label?: string;
  cta_link?: string;
  image_data_url: string; // base64 data URL
  enabled: boolean;
};

export type CustomerAppConfig = {
  branding: {
    app_name: string;
    city_label: string;
    accent_hsl: string;
    accent_dark_hsl: string;
    logo_url: string | null;
  };
  tiles: { label: string; emoji: string; category: string }[];
  promos: {
    tag: string;
    title: string;
    subtitle: string;
    code: string;
    gradient: 'hero' | 'dark';
    enabled: boolean;
  }[];
  hero_cards: HeroCard[];
  sections: {
    show_tiles: boolean;
    show_promos: boolean;
    show_categories: boolean;
    show_promoted: boolean;
    show_nearby: boolean;
    show_hero_carousel: boolean;
    show_pro_delivery: boolean;
    show_order_again: boolean;
  };
};

export const DEFAULT_CONFIG: CustomerAppConfig = {
  branding: {
    app_name: 'Fresh Delivery',
    city_label: 'Ιωάννινα',
    accent_hsl: '4 90% 47%',
    accent_dark_hsl: '4 90% 38%',
    logo_url: null,
  },
  tiles: [
    { label: 'Φαγητό', emoji: '🍔', category: 'all' },
    { label: 'Πίτσα', emoji: '🍕', category: 'Πίτσες' },
    { label: 'Καφές', emoji: '☕', category: 'Καφέδες' },
    { label: 'Γλυκά', emoji: '🍰', category: 'Γλυκά' },
  ],
  promos: [
    { tag: 'NEW', title: 'Δωρεάν παράδοση', subtitle: 'στην πρώτη σου παραγγελία', code: 'WELCOME', gradient: 'hero', enabled: true },
  ],
  hero_cards: [],
  sections: {
    show_tiles: true,
    show_promos: true,
    show_categories: true,
    show_promoted: true,
    show_nearby: true,
    show_hero_carousel: true,
    show_pro_delivery: false,
    show_order_again: false,
  },
};

/** Reads the PUBLISHED customer app config + subscribes to live updates. */
export function useCustomerAppConfig(): CustomerAppConfig {
  const [config, setConfig] = useState<CustomerAppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await (supabase as any)
        .from('customer_app_config')
        .select('published_config')
        .maybeSingle();
      if (!mounted) return;
      const cfg = data?.published_config;
      if (cfg && Object.keys(cfg).length) {
        setConfig({ ...DEFAULT_CONFIG, ...cfg, branding: { ...DEFAULT_CONFIG.branding, ...(cfg.branding ?? {}) }, sections: { ...DEFAULT_CONFIG.sections, ...(cfg.sections ?? {}) } });
      }
    };
    load();
    const channel = supabase
      .channel(`customer-app-config-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_app_config' }, load)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return config;
}
