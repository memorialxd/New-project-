import { useEffect, useState } from 'react';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command';
import { NAV_SECTIONS } from '@/components/admin/AdminSidebar';

interface Props {
  onJump: (tabId: string) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * ⌘K / Ctrl+K palette: instantly jump to any admin tab.
 * One-stop discoverability for every feature in the panel.
 */
export default function AdminCommandPalette({ onJump, open, onOpenChange }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Αναζήτηση: tab, feature, ρύθμιση…" />
      <CommandList>
        <CommandEmpty>Δεν βρέθηκαν αποτελέσματα.</CommandEmpty>
        {NAV_SECTIONS.map(sec => (
          <CommandGroup key={sec.id} heading={sec.label}>
            {sec.tabs.map(t => (
              <CommandItem
                key={t.id}
                value={`${sec.label} ${t.label}`}
                onSelect={() => { onJump(t.id); onOpenChange(false); }}
              >
                <sec.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{t.label}</span>
                <CommandShortcut className="text-[10px] uppercase">{sec.label}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
