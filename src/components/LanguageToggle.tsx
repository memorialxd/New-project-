import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Languages } from 'lucide-react';

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();

  if (compact) {
    return (
      <button
        onClick={() => setLang(lang === 'el' ? 'en' : 'el')}
        className="h-8 px-2.5 rounded-full bg-muted hover:bg-muted/80 transition-colors flex items-center gap-1 text-xs font-bold uppercase text-foreground"
        aria-label="Switch language"
      >
        <Languages className="h-3.5 w-3.5" />
        {lang === 'el' ? 'EL' : 'EN'}
      </button>
    );
  }

  return (
    <div className="inline-flex rounded-full border border-border p-0.5 bg-card">
      <Button
        size="sm"
        variant={lang === 'el' ? 'default' : 'ghost'}
        className="rounded-full h-8 px-4 text-xs font-bold"
        onClick={() => setLang('el')}
      >
        Ελληνικά
      </Button>
      <Button
        size="sm"
        variant={lang === 'en' ? 'default' : 'ghost'}
        className="rounded-full h-8 px-4 text-xs font-bold"
        onClick={() => setLang('en')}
      >
        English
      </Button>
    </div>
  );
}
