import { useEffect, useRef, useState } from 'react';
import { Send, Loader2, Smile, ImageIcon, Sparkles, X, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';

export type ComposerAttachment = { url: string; type: 'image' | 'gif' };

interface ChatComposerProps {
  onSend: (text: string, attachment: ComposerAttachment | null) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  /** Sub-folder under user-id for uploaded images, e.g. "tickets" or "team" */
  uploadFolder?: string;
  /** Optional controlled draft text (for canned replies, etc.) */
  draft?: string;
  onDraftChange?: (text: string) => void;
}

// Built-in trending pack (Tenor public CDN — these are stable category feeds)
// Used when no TENOR_API_KEY edge function is configured.
const TRENDING_GIFS = [
  'https://media.tenor.com/x8v1oNUOmg4AAAAi/thumbs-up-thumbs.gif',
  'https://media.tenor.com/I6kN-6X2K1IAAAAi/clapping.gif',
  'https://media.tenor.com/dn6r5BPRhMUAAAAi/fire-flame.gif',
  'https://media.tenor.com/0yzMK5B3-MIAAAAi/ok-okay.gif',
  'https://media.tenor.com/hNB3pkwa6OUAAAAi/heart-love.gif',
  'https://media.tenor.com/SbVMU_Z8NM0AAAAi/lol-laughing.gif',
  'https://media.tenor.com/pHYE4yE8m4cAAAAi/thinking-think.gif',
  'https://media.tenor.com/CDeyn7DAi1IAAAAi/sad-cry.gif',
  'https://media.tenor.com/TR-nL5fcDmoAAAAi/eye-roll-annoyed.gif',
  'https://media.tenor.com/iEsCK0YQT58AAAAi/sleepy-tired.gif',
  'https://media.tenor.com/JRpJv5z0o3oAAAAi/celebrate-party.gif',
  'https://media.tenor.com/9JyJU3l4f1AAAAAi/wave-hello.gif',
];

export function ChatComposer({
  onSend,
  disabled,
  placeholder = 'Γράψτε ένα μήνυμα...',
  rows = 2,
  uploadFolder = 'misc',
  draft,
  onDraftChange,
}: ChatComposerProps) {
  const { user } = useAuth();
  const [internalText, setInternalText] = useState('');
  const text = draft !== undefined ? draft : internalText;
  const setText = (v: string | ((p: string) => string)) => {
    const next = typeof v === 'function' ? (v as (p: string) => string)(text) : v;
    if (onDraftChange) onDraftChange(next);
    if (draft === undefined) setInternalText(next);
  };
  const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<string[]>(TRENDING_GIFS);
  const [searchingGifs, setSearchingGifs] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Reset gif results when popover opens
  useEffect(() => {
    if (gifOpen) {
      setGifQuery('');
      setGifResults(TRENDING_GIFS);
    }
  }, [gifOpen]);

  const insertEmoji = (emoji: string) => {
    const el = textRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const onPickFile = async (file: File) => {
    if (!user) {
      toast.error('Πρέπει να συνδεθείτε');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Μόνο εικόνες επιτρέπονται');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Μέγιστο μέγεθος 8MB');
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${user.id}/${uploadFolder}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from('chat-attachments')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      // Bucket is private — store the storage path with a sentinel so ChatAttachment
      // can resolve a fresh signed URL on render.
      setAttachment({ url: `storage:chat-attachments/${path}`, type: file.type === 'image/gif' ? 'gif' : 'image' });
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία ανεβάσματος');
    } finally {
      setUploading(false);
    }
  };

  const searchGifs = async (q: string) => {
    setGifQuery(q);
    if (!q.trim()) {
      setGifResults(TRENDING_GIFS);
      return;
    }
    setSearchingGifs(true);
    try {
      // Try edge function (uses TENOR_API_KEY if set). Fall back to filtered trending.
      const { data, error } = await supabase.functions.invoke('tenor-search', {
        body: { q, limit: 24 },
      });
      if (error || !data?.results?.length) {
        setGifResults(TRENDING_GIFS);
      } else {
        setGifResults(data.results as string[]);
      }
    } catch {
      setGifResults(TRENDING_GIFS);
    } finally {
      setSearchingGifs(false);
    }
  };

  const pickGif = (url: string) => {
    setAttachment({ url, type: 'gif' });
    setGifOpen(false);
  };

  const handleSend = async () => {
    if (sending || disabled) return;
    if (!text.trim() && !attachment) return;
    setSending(true);
    try {
      await onSend(text.trim(), attachment);
      setText('');
      setAttachment(null);
    } finally {
      setSending(false);
    }
  };

  const canSend = (!!text.trim() || !!attachment) && !sending && !uploading && !disabled;

  return (
    <div className="border-t bg-card">
      {attachment && (
        <div className="px-3 pt-2">
          <div className="relative inline-block rounded-lg overflow-hidden border bg-muted">
            <img src={attachment.url} alt="attachment" className="max-h-32 max-w-[180px] object-cover" />
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/90 border flex items-center justify-center hover:bg-background"
              aria-label="Αφαίρεση"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <span className="absolute bottom-1 left-1 text-[9px] uppercase font-bold tracking-wide px-1.5 py-0.5 rounded bg-background/90 border">
              {attachment.type}
            </span>
          </div>
        </div>
      )}

      <div className="p-2.5 flex gap-1.5 items-end">
        <div className="flex items-center gap-0.5 pb-1">
          {/* Emoji */}
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label="Emoji">
                <Smile className="h-4.5 w-4.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="p-0 w-auto border-0 shadow-xl">
              <EmojiPicker
                onEmojiClick={(e) => insertEmoji(e.emoji)}
                emojiStyle={EmojiStyle.NATIVE}
                theme={Theme.AUTO}
                width={320}
                height={380}
                searchPlaceholder="Αναζήτηση emoji..."
                previewConfig={{ showPreview: false }}
                lazyLoadEmojis
              />
            </PopoverContent>
          </Popover>

          {/* GIF */}
          <Popover open={gifOpen} onOpenChange={setGifOpen}>
            <PopoverTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label="GIF">
                <Sparkles className="h-4.5 w-4.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="p-2 w-[340px]">
              <div className="flex items-center gap-2 mb-2">
                <Input
                  autoFocus
                  placeholder="Αναζήτηση GIF..."
                  value={gifQuery}
                  onChange={(e) => searchGifs(e.target.value)}
                  className="h-8 text-sm"
                />
                {searchingGifs && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-[280px] overflow-y-auto">
                {gifResults.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => pickGif(url)}
                    className="rounded-md overflow-hidden border bg-muted hover:ring-2 hover:ring-primary transition-all aspect-square"
                  >
                    <img src={url} alt="gif" loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
                {!gifResults.length && !searchingGifs && (
                  <p className="col-span-3 text-center text-xs text-muted-foreground py-6">
                    Κανένα αποτέλεσμα
                  </p>
                )}
              </div>
              <p className="text-[9px] text-muted-foreground text-center mt-1.5">
                Powered by Tenor
              </p>
            </PopoverContent>
          </Popover>

          {/* Image upload */}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            aria-label="Επισύναψη εικόνας"
          >
            {uploading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <ImageIcon className="h-4.5 w-4.5" />}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <Textarea
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          rows={rows}
          className="resize-none"
          disabled={disabled}
        />
        <Button
          onClick={handleSend}
          disabled={!canSend}
          size="icon"
          className="h-10 w-10 shrink-0"
          aria-label="Αποστολή"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
