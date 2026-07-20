import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useAnnouncements(audience?: 'drivers' | 'store_owners' | 'support' | 'all') {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('announcements-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['announcements'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['announcements', audience],
    queryFn: async () => {
      let query = supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (audience && audience !== 'all') {
        query = query.in('target_audience', [audience, 'all']);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}
