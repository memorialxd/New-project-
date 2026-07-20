import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/button';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useT();

  return (
    <div className="inline-flex rounded-full border border-border p-0.5 bg-card">
      <Button
        size="sm"
        variant={theme === 'light' ? 'default' : 'ghost'}
        className="rounded-full h-8 px-3 text-xs"
        onClick={() => setTheme('light')}
      >
        <Sun className="h-3.5 w-3.5 mr-1.5" />
        {t('profile.light')}
      </Button>
      <Button
        size="sm"
        variant={theme === 'dark' ? 'default' : 'ghost'}
        className="rounded-full h-8 px-3 text-xs"
        onClick={() => setTheme('dark')}
      >
        <Moon className="h-3.5 w-3.5 mr-1.5" />
        {t('profile.dark')}
      </Button>
      <Button
        size="sm"
        variant={theme === 'system' ? 'default' : 'ghost'}
        className="rounded-full h-8 px-3 text-xs"
        onClick={() => setTheme('system')}
      >
        <Monitor className="h-3.5 w-3.5 mr-1.5" />
        {t('profile.system')}
      </Button>
    </div>
  );
}
