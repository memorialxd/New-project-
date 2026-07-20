import { useRef, useState, useCallback, useEffect } from 'react';
import { Power, AlertTriangle, ChevronRight } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface SlideToggleProps {
  isOn: boolean;
  onToggle: (value: boolean) => void;
  onLabel?: string;
  offLabel?: string;
  disabled?: boolean;
}

const THUMB_SIZE = 52;
const TRACK_PADDING = 4;
const ON_THRESHOLD = 0.5;   // easy to go online
const OFF_THRESHOLD = 0.92; // hard to go offline

export function SlideToggle({
  isOn,
  onToggle,
  onLabel = 'Είσαι Online',
  offLabel = 'Σύρε για να συνδεθείς',
  disabled = false,
}: SlideToggleProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [trackW, setTrackW] = useState(0);
  const startX = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    if (!trackRef.current) return;
    const ro = new ResizeObserver(() => {
      if (trackRef.current) setTrackW(trackRef.current.offsetWidth);
    });
    ro.observe(trackRef.current);
    setTrackW(trackRef.current.offsetWidth);
    return () => ro.disconnect();
  }, []);

  const getMaxX = useCallback(() => {
    return Math.max(0, trackW - THUMB_SIZE - TRACK_PADDING * 2);
  }, [trackW]);

  const getRestX = useCallback(() => (isOn ? getMaxX() : 0), [isOn, getMaxX]);

  const handleStart = (clientX: number) => {
    if (disabled) return;
    dragging.current = true;
    startX.current = clientX - getRestX();
    setDragX(getRestX());
  };

  const handleMove = (clientX: number) => {
    if (!dragging.current) return;
    const maxX = getMaxX();
    const x = Math.max(0, Math.min(maxX, clientX - startX.current));
    setDragX(x);
  };

  const handleEnd = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const maxX = getMaxX();
    const finalX = dragX ?? 0;

    if (!isOn) {
      if (finalX > maxX * ON_THRESHOLD) {
        setDragX(null);
        onToggle(true);
        if ('vibrate' in navigator) try { navigator.vibrate(40); } catch {}
        return;
      }
    } else {
      const offProgress = 1 - finalX / Math.max(1, maxX);
      if (offProgress > OFF_THRESHOLD) {
        setDragX(null);
        setConfirmOff(true);
        return;
      }
    }
    setDragX(null);
  };

  const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX);
  const onTouchMove = (e: React.TouchEvent) => { e.preventDefault(); handleMove(e.touches[0].clientX); };
  const onTouchEnd = () => handleEnd();
  const onMouseDown = (e: React.MouseEvent) => { e.preventDefault(); handleStart(e.clientX); };
  const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX);
  const onMouseUp = () => handleEnd();
  const onMouseLeave = () => { if (dragging.current) handleEnd(); };

  const currentX = dragX !== null ? dragX : getRestX();
  const maxX = getMaxX();
  const progress = maxX > 0 ? currentX / maxX : (isOn ? 1 : 0);
  const isDragging = dragX !== null;

  const fillTransition = !isDragging
    ? 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)'
    : 'none';
  const thumbTransition = !isDragging
    ? 'left 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.3s, transform 0.2s, box-shadow 0.3s'
    : 'background-color 0.2s, transform 0.15s, box-shadow 0.2s';

  // Tip label changes during drag in either direction
  const label = (() => {
    if (!isOn) return progress > 0.5 ? 'Άσε για να συνδεθείς' : offLabel;
    if (isDragging) {
      const off = 1 - progress;
      if (off > OFF_THRESHOLD) return 'Άσε για επιβεβαίωση';
      if (off > 0.4) return `Σύρε ως το τέλος για offline`;
      return 'Σύρε αριστερά για offline';
    }
    return onLabel;
  })();

  return (
    <>
      <div
        ref={trackRef}
        className={`relative h-16 rounded-full overflow-hidden select-none touch-none transition-all duration-300 ${
          isOn
            ? 'bg-gradient-to-r from-[hsl(var(--driver-accent))]/15 via-[hsl(var(--driver-accent))]/10 to-[hsl(var(--driver-accent))]/5 border border-[hsl(var(--driver-accent))]/30 shadow-[0_0_30px_-6px_hsl(var(--driver-accent)/0.4)]'
            : 'bg-[hsl(var(--driver-surface))] border border-[hsl(var(--driver-border))]'
        } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      >
        {/* Animated background fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: '100%',
            background: 'linear-gradient(90deg, hsl(var(--driver-accent)/0.45) 0%, hsl(var(--driver-accent)/0.25) 60%, transparent 100%)',
            transformOrigin: 'left center',
            transform: `scaleX(${progress})`,
            transition: fillTransition,
          }}
        />

        {/* Shimmer sweep when ON */}
        {isOn && !isDragging && (
          <div
            className="absolute inset-0 pointer-events-none opacity-50"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, hsl(var(--driver-accent)/0.3) 50%, transparent 100%)',
              animation: 'slide-shimmer 2.4s ease-in-out infinite',
              backgroundSize: '200% 100%',
            }}
          />
        )}

        {/* Center label */}
        <div
          className="absolute inset-y-0 flex items-center justify-center pointer-events-none"
          style={{ left: THUMB_SIZE + TRACK_PADDING * 2, right: TRACK_PADDING * 3 }}
        >
          <span
            className={`font-heading font-bold text-[13px] tracking-tight transition-colors duration-300 text-center truncate w-full ${
              progress > 0.45 ? 'text-[hsl(var(--driver-accent))]' : 'text-[hsl(var(--driver-text-muted))]'
            }`}
          >
            {label}
          </span>
        </div>

        {/* Pulsing arrow hint when OFF — single chevron, subtle */}
        {!isOn && !isDragging && progress < 0.1 && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <ChevronRight
              className="h-4 w-4 text-[hsl(var(--driver-text-muted))] opacity-60"
              style={{ animation: `slide-arrow 1.6s ease-in-out infinite` }}
            />
          </div>
        )}

        {/* Thumb */}
        <div
          className={`absolute top-1 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none ${
            progress > 0.45
              ? 'bg-gradient-to-br from-[hsl(var(--driver-accent))] to-[hsl(var(--driver-accent))]/80'
              : 'bg-gradient-to-br from-[hsl(var(--driver-text))] to-[hsl(var(--driver-text-muted))]'
          }`}
          style={{
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            left: `${TRACK_PADDING + currentX}px`,
            transition: thumbTransition,
            boxShadow: progress > 0.45
              ? '0 6px 20px -2px hsl(var(--driver-accent)/0.6), 0 0 0 1px hsl(var(--driver-accent)/0.3) inset'
              : '0 4px 14px -2px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08) inset',
            transform: isDragging ? 'scale(1.08)' : 'scale(1)',
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onMouseDown={onMouseDown}
        >
          {/* Inner glow ring */}
          {progress > 0.45 && !isDragging && (
            <span
              className="absolute inset-0 rounded-full"
              style={{
                animation: 'thumb-pulse 2s ease-in-out infinite',
                boxShadow: '0 0 0 0 hsl(var(--driver-accent)/0.6)',
              }}
            />
          )}
          <Power className="h-5 w-5 text-white drop-shadow" strokeWidth={2.5} />
        </div>
      </div>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Να μπεις offline;
            </AlertDialogTitle>
            <AlertDialogDescription>
              Δεν θα λαμβάνεις άλλες παραγγελίες μέχρι να επιστρέψεις online.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Άκυρο, μένω online</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onToggle(false)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ναι, βγες offline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
