import { useState, useEffect, useCallback } from 'react';
import { Heart } from 'lucide-react';

/**
 * efood-style 1+1 hero card.
 * Big red banner with a white heart-shaped “1+1” badge, floating food
 * illustrations, and a carousel-like dot indicator. Tapping it scrolls to
 * the 1+1 offers row below.
 */
export function OnePlusOneHero() {
  const [current, setCurrent] = useState(0);

  const next = useCallback(() => setCurrent(c => (c + 1) % 3), []);

  useEffect(() => {
    const t = setInterval(next, 5000);
    return () => clearInterval(t);
  }, [next]);

  const handleClick = () => {
    const target = document.getElementById('one-plus-one-row');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="px-4 pt-4">
      <button
        onClick={handleClick}
        className="relative w-full overflow-hidden rounded-[22px] h-[170px] text-left group active:scale-[0.98] transition-transform duration-200"
        style={{
          background: 'linear-gradient(135deg, hsl(0 85% 42%) 0%, hsl(0 80% 48%) 50%, hsl(0 85% 42%) 100%)',
          boxShadow: '0 12px 32px -10px hsl(0 85% 42% / 0.45), inset 0 1px 0 hsl(0 0% 100% / 0.12)',
        }}
        aria-label="1+1 Προσφορές"
      >
        {/* Subtle radial glow behind the heart */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[280px] w-[280px] rounded-full bg-white/8 blur-2xl" />

        {/* Floating food illustrations */}
        <div className="emoji absolute -top-2 left-3 text-[44px] rotate-[-12deg] drop-shadow-lg opacity-95">🍣</div>
        <div className="emoji absolute top-4 right-2 text-[40px] rotate-[10deg] drop-shadow-lg opacity-95">🥤</div>
        <div className="emoji absolute bottom-10 left-1 text-[38px] rotate-[-8deg] drop-shadow-lg opacity-95">🍩</div>
        <div className="emoji absolute -bottom-3 right-4 text-[52px] rotate-[6deg] drop-shadow-lg opacity-95">🍔</div>
        <div className="emoji absolute bottom-2 left-1/2 -translate-x-1/2 text-[36px] rotate-[4deg] drop-shadow-lg opacity-90">🍕</div>

        {/* Center heart badge + 1+1 */}
        <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
          <div className="relative">
            <Heart className="h-28 w-28 text-white fill-white drop-shadow-[0_6px_18px_hsl(0_0%_0%/0.25)]" strokeWidth={1.5} />
            <div className="absolute inset-0 flex items-center justify-center pb-1">
              <span className="font-heading font-black text-[hsl(0,85%,42%)] text-[40px] leading-none tracking-tight">
                1+1
              </span>
            </div>
          </div>
        </div>

        {/* Bottom copy */}
        <div className="absolute bottom-0 inset-x-0 p-4 flex flex-col items-center text-center">
          <p className="font-heading font-black text-white text-[17px] leading-tight drop-shadow-md">
            επιστρέφει πιο δυνατό από ποτέ
          </p>
          <p className="text-white/85 text-[12px] font-semibold mt-0.5">
            έως 28/06
          </p>
        </div>

        {/* Carousel dots */}
        <div className="absolute bottom-2.5 right-4 flex gap-1.5">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === current ? 'w-4 bg-white' : 'w-1.5 bg-white/50'
              }`}
            />
          ))}
        </div>
      </button>
    </div>
  );
}
