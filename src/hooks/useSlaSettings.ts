import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type TicketPriority = 'low' | 'normal' | 'high' | 'sos';

export interface SlaBaseSettings {
  warn: number;
  urgent: number;
  breach: number;
  agentScaling: boolean;
  ticketsPerAgent: number;
}

const DEFAULTS: SlaBaseSettings = {
  warn: 60,
  urgent: 180,
  breach: 600,
  agentScaling: true,
  ticketsPerAgent: 5,
};

// Priority multipliers — lower = stricter (faster) deadline
export const PRIORITY_MULTIPLIERS: Record<TicketPriority, number> = {
  sos: 0.25,    // SOS: 4x faster
  high: 0.6,    // High: ~40% faster
  normal: 1,    // baseline
  low: 1.75,    // Low: 75% more time
};

export function useSlaSettings() {
  return useQuery({
    queryKey: ['sla-settings'],
    queryFn: async (): Promise<SlaBaseSettings> => {
      const { data } = await supabase
        .from('platform_settings')
        .select('sla_warn_seconds, sla_urgent_seconds, sla_breach_seconds, sla_agent_scaling, sla_tickets_per_agent')
        .eq('id', 1)
        .maybeSingle();
      if (!data) return DEFAULTS;
      return {
        warn: (data as any).sla_warn_seconds ?? DEFAULTS.warn,
        urgent: (data as any).sla_urgent_seconds ?? DEFAULTS.urgent,
        breach: (data as any).sla_breach_seconds ?? DEFAULTS.breach,
        agentScaling: (data as any).sla_agent_scaling ?? DEFAULTS.agentScaling,
        ticketsPerAgent: (data as any).sla_tickets_per_agent ?? DEFAULTS.ticketsPerAgent,
      };
    },
    staleTime: 30_000,
  });
}

export function useSupportLoad() {
  return useQuery({
    queryKey: ['support-load'],
    queryFn: async () => {
      const [{ data: agents }, { count: openCount }] = await Promise.all([
        supabase.rpc('count_active_support_agents'),
        supabase
          .from('support_tickets')
          .select('id', { count: 'exact', head: true })
          .in('status', ['open', 'in_progress']),
      ]);
      return {
        agentCount: Math.max(1, (agents as unknown as number) ?? 1),
        openTickets: openCount ?? 0,
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export interface EffectiveSla {
  warn: number;
  urgent: number;
  breach: number;
  loadFactor: number;
  priorityFactor: number;
}

/**
 * Computes effective SLA thresholds for a ticket given its priority and current support load.
 * - Priority tightens (SOS/high) or loosens (low) deadlines.
 * - Agent scaling: when ticket queue exceeds capacity (agents × ticketsPerAgent),
 *   thresholds expand proportionally so agents aren't unfairly flagged during overload.
 */
export function useEffectiveSla(priority: TicketPriority = 'normal'): EffectiveSla {
  const { data: base } = useSlaSettings();
  const { data: load } = useSupportLoad();

  const b = base ?? DEFAULTS;
  const priorityFactor = PRIORITY_MULTIPLIERS[priority] ?? 1;

  let loadFactor = 1;
  if (b.agentScaling && load) {
    const capacity = Math.max(1, load.agentCount * b.ticketsPerAgent);
    // 1.0 at/under capacity, grows linearly above. Cap at 3x to prevent absurd timers.
    loadFactor = Math.min(3, Math.max(1, load.openTickets / capacity));
  }

  const factor = priorityFactor * loadFactor;
  return {
    warn: Math.round(b.warn * factor),
    urgent: Math.round(b.urgent * factor),
    breach: Math.round(b.breach * factor),
    loadFactor,
    priorityFactor,
  };
}
