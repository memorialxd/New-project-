import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Trash2, Plus, Eye, Rocket, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_CONFIG, type CustomerAppConfig } from '@/hooks/useCustomerAppConfig';

type Row = {
  draft_config: CustomerAppConfig;
  published_config: CustomerAppConfig;
  published_at: string | null;
  updated_at: string;
};

export default function CustomerAppCustomization() {
  const [row, setRow] = useState<Row | null>(null);
  const [draft, setDraft] = useState<CustomerAppConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const load = async () => {
    const { data } = await (supabase as any)
      .from('customer_app_config')
      .select('draft_config, published_config, published_at, updated_at')
      .maybeSingle();
    if (data) {
      const merged = { ...DEFAULT_CONFIG, ...(data.draft_config ?? {}) };
      setRow(data);
      setDraft(merged);
    }
  };

  useEffect(() => { load(); }, []);

  const saveDraft = async () => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from('customer_app_config')
      .update({ draft_config: draft })
      .eq('id', true);
    setSaving(false);
    if (error) toast.error('Σφάλμα αποθήκευσης: ' + error.message);
    else { toast.success('Πρόχειρο αποθηκεύτηκε'); load(); }
  };

  const publish = async () => {
    setPublishing(true);
    const { error } = await (supabase as any)
      .from('customer_app_config')
      .update({
        draft_config: draft,
        published_config: draft,
        published_at: new Date().toISOString(),
      })
      .eq('id', true);
    setPublishing(false);
    if (error) toast.error('Σφάλμα δημοσίευσης: ' + error.message);
    else { toast.success('Δημοσιεύτηκε στο customer app'); load(); }
  };

  const revert = () => {
    if (row) setDraft({ ...DEFAULT_CONFIG, ...(row.published_config ?? {}) });
    toast.info('Επαναφορά στο δημοσιευμένο');
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(row?.draft_config);
  const hasUnpublished = JSON.stringify(draft) !== JSON.stringify(row?.published_config);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-heading font-extrabold">Customer App — Παραμετροποίηση</h1>
          <p className="text-sm text-muted-foreground">
            Επεξεργάσου σε πρόχειρο, μετά κάνε δημοσίευση για να γίνει live.
            {row?.published_at && <> · Τελευταία δημοσίευση: {new Date(row.published_at).toLocaleString('el-GR')}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={revert} disabled={!row}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Επαναφορά
          </Button>
          <Button variant="outline" size="sm" onClick={saveDraft} disabled={!isDirty || saving}>
            <Eye className="h-4 w-4 mr-1.5" /> Αποθήκευση πρόχειρου
          </Button>
          <Button size="sm" onClick={publish} disabled={!hasUnpublished || publishing}>
            <Rocket className="h-4 w-4 mr-1.5" /> Δημοσίευση
          </Button>
        </div>
      </div>

      <Tabs defaultValue="branding">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="tiles">Πλακίδια</TabsTrigger>
          <TabsTrigger value="promos">Promo banners</TabsTrigger>
          <TabsTrigger value="sections">Ενότητες</TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <Card>
            <CardHeader><CardTitle className="text-base">Branding</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Όνομα εφαρμογής</Label>
                <Input
                  value={draft.branding.app_name}
                  onChange={e => setDraft({ ...draft, branding: { ...draft.branding, app_name: e.target.value } })}
                />
              </div>
              <div>
                <Label>Πόλη / Ετικέτα παράδοσης</Label>
                <Input
                  value={draft.branding.city_label}
                  onChange={e => setDraft({ ...draft, branding: { ...draft.branding, city_label: e.target.value } })}
                />
              </div>
              <div>
                <Label>Accent χρώμα (HSL)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    value={draft.branding.accent_hsl}
                    onChange={e => setDraft({ ...draft, branding: { ...draft.branding, accent_hsl: e.target.value } })}
                    placeholder="4 90% 47%"
                  />
                  <div className="h-9 w-9 rounded-md border" style={{ background: `hsl(${draft.branding.accent_hsl})` }} />
                </div>
              </div>
              <div>
                <Label>Accent σκούρο (HSL)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    value={draft.branding.accent_dark_hsl}
                    onChange={e => setDraft({ ...draft, branding: { ...draft.branding, accent_dark_hsl: e.target.value } })}
                    placeholder="4 90% 38%"
                  />
                  <div className="h-9 w-9 rounded-md border" style={{ background: `hsl(${draft.branding.accent_dark_hsl})` }} />
                </div>
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label>Logo εφαρμογής</Label>
                <div className="flex items-center gap-3">
                  {draft.branding.logo_url ? (
                    <img src={draft.branding.logo_url} alt="Logo" className="h-16 w-16 rounded-lg border object-contain bg-card" />
                  ) : (
                    <div className="h-16 w-16 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">Κανένα</div>
                  )}
                  <div className="flex-1 space-y-2">
                    <Input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      disabled={uploadingLogo}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingLogo(true);
                        const ext = file.name.split('.').pop() || 'png';
                        const path = `logo-${Date.now()}.${ext}`;
                        const { error: upErr } = await supabase.storage.from('app-branding').upload(path, file, { cacheControl: '3600', upsert: false });
                        if (upErr) { toast.error('Αποτυχία upload: ' + upErr.message); setUploadingLogo(false); return; }
                        const { data: pub } = supabase.storage.from('app-branding').getPublicUrl(path);
                        setDraft({ ...draft, branding: { ...draft.branding, logo_url: pub.publicUrl } });
                        setUploadingLogo(false);
                        toast.success('Logo ανέβηκε — μην ξεχάσεις Δημοσίευση');
                      }}
                    />
                    <Input
                      value={draft.branding.logo_url ?? ''}
                      onChange={e => setDraft({ ...draft, branding: { ...draft.branding, logo_url: e.target.value || null } })}
                      placeholder="ή επικόλλησε URL..."
                    />
                    {draft.branding.logo_url && (
                      <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, branding: { ...draft.branding, logo_url: null } })}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Αφαίρεση logo
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tiles">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                Πλακίδια γρήγορης πρόσβασης
                <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, tiles: [...draft.tiles, { label: 'Νέο', emoji: '🍽️', category: 'all' }] })}>
                  <Plus className="h-4 w-4 mr-1" /> Προσθήκη
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {draft.tiles.map((tile, i) => (
                <div key={i} className="grid grid-cols-[60px_1fr_1fr_auto] gap-2 items-end">
                  <div>
                    <Label className="text-xs">Emoji</Label>
                    <Input value={tile.emoji} onChange={e => {
                      const tiles = [...draft.tiles]; tiles[i] = { ...tile, emoji: e.target.value }; setDraft({ ...draft, tiles });
                    }} />
                  </div>
                  <div>
                    <Label className="text-xs">Ετικέτα</Label>
                    <Input value={tile.label} onChange={e => {
                      const tiles = [...draft.tiles]; tiles[i] = { ...tile, label: e.target.value }; setDraft({ ...draft, tiles });
                    }} />
                  </div>
                  <div>
                    <Label className="text-xs">Κατηγορία (φίλτρο)</Label>
                    <Input value={tile.category} onChange={e => {
                      const tiles = [...draft.tiles]; tiles[i] = { ...tile, category: e.target.value }; setDraft({ ...draft, tiles });
                    }} placeholder="all ή Πίτσες..." />
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => setDraft({ ...draft, tiles: draft.tiles.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="promos">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                Promo banners
                <Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, promos: [...draft.promos, { tag: 'NEW', title: 'Τίτλος', subtitle: 'Υπότιτλος', code: 'CODE', gradient: 'hero', enabled: true }] })}>
                  <Plus className="h-4 w-4 mr-1" /> Προσθήκη
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {draft.promos.map((p, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-2 bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <Switch checked={p.enabled} onCheckedChange={v => {
                      const promos = [...draft.promos]; promos[i] = { ...p, enabled: v }; setDraft({ ...draft, promos });
                    }} />
                    <span className="text-xs text-muted-foreground flex-1">{p.enabled ? 'Ενεργό' : 'Ανενεργό'}</span>
                    <select
                      className="h-8 rounded border bg-background text-xs px-2"
                      value={p.gradient}
                      onChange={e => {
                        const promos = [...draft.promos]; promos[i] = { ...p, gradient: e.target.value as 'hero'|'dark' }; setDraft({ ...draft, promos });
                      }}
                    >
                      <option value="hero">Κόκκινο (hero)</option>
                      <option value="dark">Σκούρο</option>
                    </select>
                    <Button size="icon" variant="ghost" onClick={() => setDraft({ ...draft, promos: draft.promos.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Tag (π.χ. NEW)" value={p.tag} onChange={e => { const promos = [...draft.promos]; promos[i] = { ...p, tag: e.target.value }; setDraft({ ...draft, promos }); }} />
                    <Input placeholder="Κωδικός κουπονιού" value={p.code} onChange={e => { const promos = [...draft.promos]; promos[i] = { ...p, code: e.target.value }; setDraft({ ...draft, promos }); }} />
                    <Input className="col-span-2" placeholder="Τίτλος" value={p.title} onChange={e => { const promos = [...draft.promos]; promos[i] = { ...p, title: e.target.value }; setDraft({ ...draft, promos }); }} />
                    <Input className="col-span-2" placeholder="Υπότιτλος" value={p.subtitle} onChange={e => { const promos = [...draft.promos]; promos[i] = { ...p, subtitle: e.target.value }; setDraft({ ...draft, promos }); }} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sections">
          <Card>
            <CardHeader><CardTitle className="text-base">Ενότητες αρχικής</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {([
                ['show_tiles', 'Πλακίδια γρήγορης πρόσβασης'],
                ['show_promos', 'Promo banner carousel'],
                ['show_categories', 'Λωρίδα κατηγοριών (chips)'],
                ['show_promoted', 'Sponsored / Δημοφιλή'],
                ['show_nearby', 'Κοντινά εστιατόρια'],
                ['show_hero_carousel', 'AI hero carousel'],
                ['show_order_again', 'Λωρίδα «Παράγγειλε ξανά»'],
                ['show_pro_delivery', 'Pro delivery banner'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between border rounded-lg p-3 bg-card">
                  <span className="text-sm font-medium">{label}</span>
                  <Switch
                    checked={draft.sections[key]}
                    onCheckedChange={v => setDraft({ ...draft, sections: { ...draft.sections, [key]: v } })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
