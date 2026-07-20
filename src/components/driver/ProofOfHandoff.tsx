import { useState, useRef } from 'react';
import { Camera, CheckCircle2, Loader2, X, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  orderId: string;
  driverId: string;
  onUploaded: (publicPath: string) => Promise<void> | void;
}

/**
 * Driver-facing proof of handoff. Captures a photo (camera on mobile, file picker on desktop),
 * uploads to the private `delivery-proofs` bucket under {driver_id}/{order_id}.jpg,
 * persists `photo_verification_url` on the order via the parent callback, then
 * the parent flips the status to `delivered`.
 */
export default function ProofOfHandoff({ orderId, driverId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const pick = (f: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error('Φωτογραφία πολύ μεγάλη (max 5MB)');
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${driverId}/${orderId}.${ext}`;
      const { error } = await supabase.storage
        .from('delivery-proofs')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      await onUploaded(path);
      toast.success('Παράδοση επιβεβαιώθηκε ✓');
    } catch (e: any) {
      toast.error(e?.message ?? 'Αποτυχία ανέβασματος');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-2xl driver-glass border-2 border-[hsl(var(--driver-accent))]/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-[hsl(var(--driver-accent))]" />
        <p className="font-heading font-bold text-sm text-[hsl(var(--driver-text))]">
          Φωτογραφία Παράδοσης (υποχρεωτική)
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />

      {preview ? (
        <div className="relative">
          <img src={preview} alt="proof" className="w-full h-48 object-cover rounded-xl border border-[hsl(var(--driver-border))]" />
          <button
            onClick={() => { setPreview(null); setFile(null); }}
            disabled={uploading}
            className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center"
            aria-label="Διαγραφή"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full h-32 rounded-xl border-2 border-dashed border-[hsl(var(--driver-border))] bg-[hsl(var(--driver-surface))] flex flex-col items-center justify-center gap-2 text-[hsl(var(--driver-text-muted))] hover:border-[hsl(var(--driver-accent))]/50 transition-colors"
        >
          <Camera className="h-7 w-7" />
          <span className="text-xs font-heading">Πάτησε για λήψη φωτογραφίας</span>
        </button>
      )}

      <button
        onClick={submit}
        disabled={!file || uploading}
        className="w-full h-12 rounded-xl bg-[hsl(var(--driver-accent))] text-white font-heading font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] transition-all"
      >
        {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        {uploading ? 'Ανέβασμα...' : 'Επιβεβαίωση & Παράδοση'}
      </button>

      <p className="text-[11px] text-[hsl(var(--driver-text-muted))] leading-relaxed flex items-start gap-1.5">
        <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
        Η φωτογραφία αποθηκεύεται ασφαλώς και είναι ορατή μόνο σε εσένα, το κατάστημα και τη διαχείριση.
      </p>
    </div>
  );
}
