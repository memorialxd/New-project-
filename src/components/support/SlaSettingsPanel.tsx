import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Timer, Save, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useSlaSettings, useSupportLoad } from '@/hooks/useSlaSettings';
import { useSettingAdvisor } from '@/hooks/useSettingAdvisor';

export function SlaSettingsPanel() {
  const { data, isLoading } = useSlaSettings();
  const { data: load } = useSupportLoad();
  const qc = useQueryClient();
  const [warn, setWarn] = useState(60);
  const [urgent, setUrgent] = useState(180);
  const [breach, setBreach] = useState(600);
  const [agentScaling, setAgentScaling] = useState(true);
  const [ticketsPerAgent, setTicketsPerAgent] = useState(5);
  const [saving, setSaving] = useState(false);
  const { advise, AdvisorDialog } = useSettingAdvisor();

  useEffect(() => {
    if (data) {
      setWarn(data.warn);
      setUrgent(data.urgent);
      setBreach(data.breach);
      setAgentScaling(data.agentScaling);
      setTicketsPerAgent(data.ticketsPerAgent);
    }
  }, [data]);

  const applySave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('platform_settings')
      .update({
        sla_warn_seconds: warn,
        sla_urgent_seconds: urgent,
        sla_breach_seconds: breach,
        sla_agent_scaling: agentScaling,
        sla_tickets_per_agent: ticketsPerAgent,
      } as any)
      .eq('id', 1);
    setSaving(false);
    if (error) {
      toast.error('Αποτυχία: ' + error.message);
    } else {
      toast.success('Αποθηκεύτηκε');
      qc.invalidateQueries({ queryKey: ['sla-settings'] });
      qc.invalidateQueries({ queryKey: ['support-load'] });
    }
  };

  const save = () => {
    if (warn >= urgent || urgent >= breach) {
      toast.error('Πρέπει να ισχύει: Warn < Urgent < Breach');
      return;
    }
    advise(
      {
        setting_area: 'sla',
        setting_label: 'Όρια SLA Support',
        current_value: `warn ${data?.warn ?? '?'}s · urgent ${data?.urgent ?? '?'}s · breach ${data?.breach ?? '?'}s · ${data?.ticketsPerAgent ?? '?'} tickets/agent`,
        proposed_value: `warn ${warn}s · urgent ${urgent}s · breach ${breach}s · ${ticketsPerAgent} tickets/agent · scaling ${agentScaling ? 'on' : 'off'}`,
        context: { openTickets: load?.openTickets, agentCount: load?.agentCount },
      },
      applySave,
    );
  };

  const capacity = Math.max(1, (load?.agentCount ?? 1) * ticketsPerAgent);
  const overload = (load?.openTickets ?? 0) > capacity;

  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide font-heading font-bold text-muted-foreground flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5 text-primary" /> Όρια Χρονομετρητή SLA
          </p>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-[10px] text-muted-foreground -mt-1">
          Βασικά όρια (priority normal). SOS/High/Low προσαρμόζονται αυτόματα.
        </p>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-[10px] uppercase text-emerald-600">Warn (δ)</Label>
            <Input
              type="number"
              min={5}
              value={warn}
              onChange={(e) => setWarn(parseInt(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-orange-600">Urgent (δ)</Label>
            <Input
              type="number"
              min={10}
              value={urgent}
              onChange={(e) => setUrgent(parseInt(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase text-red-600">Breach (δ)</Label>
            <Input
              type="number"
              min={30}
              value={breach}
              onChange={(e) => setBreach(parseInt(e.target.value) || 0)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-primary" />
              <Label className="text-[11px] font-heading font-bold uppercase">Κλιμάκωση βάσει agents</Label>
            </div>
            <Switch checked={agentScaling} onCheckedChange={setAgentScaling} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Τα όρια επεκτείνονται όταν τα tickets ξεπερνούν τη χωρητικότητα.
          </p>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <Label className="text-[10px] uppercase">Tickets / Agent</Label>
              <Input
                type="number"
                min={1}
                value={ticketsPerAgent}
                onChange={(e) => setTicketsPerAgent(parseInt(e.target.value) || 1)}
                className="h-8 text-sm"
                disabled={!agentScaling}
              />
            </div>
            <div className={`text-[10px] rounded-md p-2 border ${overload ? 'border-orange-500/30 bg-orange-500/10 text-orange-700' : 'bg-muted/40'}`}>
              <p className="font-bold">{load?.agentCount ?? '—'} agents</p>
              <p>{load?.openTickets ?? 0} ανοιχτά / {capacity} χωρ.</p>
            </div>
          </div>
        </div>

        <Button size="sm" onClick={save} disabled={saving} className="w-full h-8">
          {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
          Αποθήκευση
        </Button>
      </CardContent>
      {AdvisorDialog}
    </Card>
  );
}
