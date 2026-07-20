import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

interface ChatAttachmentProps {
  url: string;
  type?: string | null;
  className?: string;
}

/**
 * Renders an image/gif attachment in a chat bubble.
 * Supports two URL forms:
 *   - "https://…"               → external URL (Tenor GIFs, legacy public URLs)
 *   - "storage:<bucket>/<path>" → private bucket reference, resolved to a signed URL
 */
export function ChatAttachment({ url, type, className }: ChatAttachmentProps) {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!url) return;

    if (url.startsWith('storage:')) {
      const rest = url.slice('storage:'.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) {
        setFailed(true);
        return;
      }
      const bucket = rest.slice(0, slash);
      const path = rest.slice(slash + 1);

      supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60) // 1h
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data?.signedUrl) {
            setFailed(true);
            return;
          }
          setResolved(data.signedUrl);
        });
    } else {
      setResolved(url);
    }

    return () => {
      cancelled = true;
    };
  }, [url]);

  const isGif = type === 'gif' || url.toLowerCase().includes('.gif');

  if (failed) {
    return (
      <div className={`text-xs text-muted-foreground italic ${className ?? ''}`}>
        Συνημμένο μη διαθέσιμο
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className={`rounded-lg border bg-muted animate-pulse h-32 w-[220px] ${className ?? ''}`} />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`block rounded-lg overflow-hidden border bg-background/40 max-w-[220px] hover:opacity-90 transition-opacity ${className ?? ''}`}
      >
        <img
          src={resolved}
          alt={isGif ? 'GIF' : 'Εικόνα'}
          loading="lazy"
          className="w-full h-auto max-h-64 object-cover"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-2 bg-background">
          <img src={resolved} alt="" className="w-full h-auto max-h-[80vh] object-contain rounded" />
        </DialogContent>
      </Dialog>
    </>
  );
}
