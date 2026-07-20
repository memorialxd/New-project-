import { toast } from 'sonner';
import { Bike } from 'lucide-react';

/** efood-style "γίνε pro" subscription banner (visual + toast). */
export default function ProBanner() {
  return (
    <section className="px-5 pt-5">
      <button
        onClick={() => toast('Σύντομα διαθέσιμο · Pro συνδρομή', { description: 'Απεριόριστες δωρεάν παραδόσεις' })}
        className="relative w-full overflow-hidden rounded-[22px] bg-gradient-to-br from-[hsl(0,80%,52%)] to-[hsl(0,75%,42%)] text-white shadow-[0_10px_24px_-8px_hsl(0_75%_40%/0.45)] active:scale-[0.99] transition-transform text-left"
      >
        <div className="flex items-center justify-between px-5 py-4 gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] opacity-85">απεριόριστο</p>
            <p className="font-heading font-black text-[26px] leading-none tracking-tight mt-1">
              δωρεάν <span className="font-light italic">delivery</span>
            </p>
            <p className="text-[11px] mt-1.5 opacity-90 font-semibold">30 ημέρες δωρεάν δοκιμή</p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <Bike className="h-9 w-9 opacity-90" strokeWidth={2.2} />
            <span className="bg-white text-[hsl(0,75%,45%)] rounded-md px-2.5 py-0.5 text-[12px] font-black tracking-tight">
              γίνε pro
            </span>
          </div>
        </div>
        <div className="pointer-events-none absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      </button>
    </section>
  );
}
