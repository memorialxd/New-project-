import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Trash2, Upload, Loader2, ArrowUp, ArrowDown, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_CONFIG, type CustomerAppConfig, type HeroCard } from '@/hooks/useCustomerAppConfig';

export default function AiHeroCardsAdmin() {
  const [config, setConfig] = useState<CustomerAppConfig>(DEFAULT_CONFIG);
  const [loaded, setLoaded] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Δες περισσότερα');
  const [ctaLink, setCtaLink] = useState('/order');
  const [prompt, setPrompt] = useState('');
  const [refImage, setRefImage] = useState<string | null>(null); // base64 data URL preview only
  const [generating, setGenerating] = useState(false);
  const [previewB64, setPreviewB64] = useState<string | null>(null);

  const load = async () => {
    const { data } = await (supabase as any)
      .from('customer_app_config')
      .select('published_config')
      .maybeSingle();
    const cfg = data?.published_config ?? {};
    setConfig({
      ...DEFAULT_CONFIG,
      ...cfg,
      hero_cards: Array.isArray(cfg.hero_cards) ? cfg.hero_cards : [],
    });
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  const updateCards = async (next: HeroCard[]) => {
    const newCfg = { ...config, hero_cards: next };
    setConfig(newCfg);
    const { error } = await (supabase as any)
      .from('customer_app_config')
      .update({
        published_config: newCfg,
        draft_config: newCfg,
        published_at: new Date().toISOString(),
      })
      .eq('id', true);
    if (error) toast.error('Αποτυχία αποθήκευσης: ' + error.message);
  };

  const onRefImage = (file: File | null) => {
    if (!file) { setRefImage(null); return; }
    const reader = new FileReader();
    reader.onload = () => setRefImage(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!prompt.trim() || !title.trim()) {
      toast.error('Δώσε τίτλο και prompt');
      return;
    }
    setGenerating(true);
    setPreviewB64(null);
    try {
      const { data, error } = await (supabase.functions as any).invoke('generate-hero-card', {
        body: {
          prompt,
          title,
          source_image_url: refImage ?? undefined,
        },
      });
      if (error) throw error;
      if (!data?.b64_json) throw new Error('Δεν επιστράφηκε εικόνα');
      setPreviewB64(data.b64_json);
      toast.success('Εικόνα δημιουργήθηκε ✨');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes('429')) toast.error('Πολλά αιτήματα — δοκίμασε σε λίγο');
      else if (msg.includes('402')) toast.error('Τέλειωσαν τα AI credits');
      else toast.error('Αποτυχία: ' + msg);
    } finally {
      setGenerating(false);
    }
  };

  const saveCard = async () => {
    if (!previewB64) return;
    const card: HeroCard = {
      id: crypto.randomUUID(),
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      cta_label: ctaLabel.trim() || undefined,
      cta_link: ctaLink.trim() || undefined,
      image_data_url: `data:image/png;base64,${previewB64}`,
      enabled: true,
    };
    await updateCards([card, ...config.hero_cards]);
    toast.success('Η κάρτα δημοσιεύτηκε στο app');
    // reset
    setTitle(''); setSubtitle(''); setPrompt(''); setRefImage(null); setPreviewB64(null);
  };

  const toggleCard = (id: string) => {
    updateCards(config.hero_cards.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c));
  };
  const deleteCard = (id: string) => {
    if (!confirm('Διαγραφή κάρτας;')) return;
    updateCards(config.hero_cards.filter(c => c.id !== id));
  };
  const move = (id: string, dir: -1 | 1) => {
    const idx = config.hero_cards.findIndex(c => c.id === id);
    if (idx < 0) return;
    const next = [...config.hero_cards];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    updateCards(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="admin-section-title flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Hero Cards
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Φτιάξε κάρτες προωθήσεων με AI και δημοσίευσέ τες απευθείας στο customer app.
          </p>
        </div>
      </div>

      {/* Generator */}
      <Card className="admin-card">
        <CardHeader>
          <CardTitle className="text-[14px]">Νέα κάρτα</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <Label className="text-[11.5px]">Τίτλος (headline)</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="π.χ. 1+1 Πίτσες όλη την ημέρα" />
            </div>
            <div>
              <Label className="text-[11.5px]">Υπότιτλος</Label>
              <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="προαιρετικό" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[11.5px]">CTA label</Label>
                <Input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} />
              </div>
              <div>
                <Label className="text-[11.5px]">CTA link</Label>
                <Input value={ctaLink} onChange={e => setCtaLink(e.target.value)} placeholder="/order" />
              </div>
            </div>
            <div>
              <Label className="text-[11.5px]">Prompt για την εικόνα</Label>
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
                placeholder="π.χ. φρέσκα νοστιμότατα burger σε ξύλινο τραπέζι, ζεστό φως, ατμός"
              />
            </div>
            <div>
              <Label className="text-[11.5px]">Reference image (προαιρετικό)</Label>
              <label className="mt-1 flex items-center gap-2 cursor-pointer px-3 py-2 rounded-md border border-dashed border-border hover:bg-muted/40 text-[12px]">
                <Upload className="h-3.5 w-3.5" />
                {refImage ? 'Αλλαγή εικόνας' : 'Ανέβασε εικόνα'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => onRefImage(e.target.files?.[0] ?? null)}
                />
              </label>
              {refImage && (
                <div className="mt-2 flex items-center gap-2">
                  <img src={refImage} className="h-14 w-14 object-cover rounded" />
                  <Button size="sm" variant="ghost" onClick={() => setRefImage(null)}>Αφαίρεση</Button>
                </div>
              )}
            </div>
            <Button onClick={generate} disabled={generating} className="w-full">
              {generating ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Δημιουργία…</> : <><Sparkles className="h-3.5 w-3.5 mr-2" /> Generate</>}
            </Button>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label className="text-[11.5px]">Προεπισκόπηση</Label>
            <div className="relative aspect-[16/10] rounded-2xl overflow-hidden border border-border bg-muted/20 flex items-center justify-center">
              {previewB64 ? (
                <>
                  <img src={`data:image/png;base64,${previewB64}`} className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-black/30 to-transparent" />
                  <div className="absolute inset-0 flex flex-col justify-end p-4">
                    <h3 className="text-white font-black text-xl drop-shadow">{title}</h3>
                    {subtitle && <p className="text-white/90 text-xs font-semibold mt-1">{subtitle}</p>}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground text-[12px] flex flex-col items-center gap-2">
                  <ImageIcon className="h-8 w-8 opacity-50" />
                  Η εικόνα θα εμφανιστεί εδώ
                </div>
              )}
            </div>
            <Button onClick={saveCard} disabled={!previewB64} variant="default" className="w-full">
              Δημοσίευση στο app
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Existing cards */}
      <Card className="admin-card">
        <CardHeader>
          <CardTitle className="text-[14px]">Δημοσιευμένες κάρτες ({config.hero_cards.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {!loaded ? (
            <div className="text-center text-muted-foreground py-6 text-[12px]">Φόρτωση…</div>
          ) : config.hero_cards.length === 0 ? (
            <div className="text-center text-muted-foreground py-8 text-[12px]">Δεν υπάρχουν κάρτες ακόμα.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {config.hero_cards.map((card, idx) => (
                <div key={card.id} className="rounded-xl border border-border overflow-hidden bg-card">
                  <div className="relative aspect-[16/10]">
                    <img src={card.image_data_url} className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-black/20 to-transparent" />
                    <div className="absolute inset-0 p-3 flex flex-col justify-end">
                      <h4 className="text-white font-black text-base leading-tight drop-shadow">{card.title}</h4>
                      {card.subtitle && <p className="text-white/90 text-[11px] mt-0.5">{card.subtitle}</p>}
                    </div>
                  </div>
                  <div className="p-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      <Switch checked={card.enabled} onCheckedChange={() => toggleCard(card.id)} />
                      <span className={card.enabled ? 'text-foreground' : 'text-muted-foreground'}>
                        {card.enabled ? 'Ενεργή' : 'Ανενεργή'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(card.id, -1)} disabled={idx === 0}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(card.id, +1)} disabled={idx === config.hero_cards.length - 1}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteCard(card.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
