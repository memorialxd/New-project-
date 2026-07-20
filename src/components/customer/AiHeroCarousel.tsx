import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useCustomerAppConfig } from '@/hooks/useCustomerAppConfig';
import { useNavigate } from 'react-router-dom';

export function AiHeroCarousel() {
  const config = useCustomerAppConfig();
  const navigate = useNavigate();
  const cards = (config.hero_cards ?? []).filter(c => c.enabled && c.image_data_url);
  const [active, setActive] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (cards.length < 2) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      setActive(prev => {
        const next = (prev + 1) % cards.length;
        scrollerRef.current?.scrollTo({
          left: next * (scrollerRef.current?.clientWidth ?? 0),
          behavior: 'smooth',
        });
        return next;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [cards.length]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== active) setActive(idx);
  };

  if (cards.length === 0) return null;

  return (
    <div className="px-5 pt-5">
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        onTouchStart={() => { pausedRef.current = true; }}
        onTouchEnd={() => { pausedRef.current = false; }}
        className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar rounded-3xl"
        style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}
      >
        {cards.map(card => (
          <button
            key={card.id}
            onClick={() => {
              if (card.cta_link) {
                if (card.cta_link.startsWith('http')) window.location.href = card.cta_link;
                else navigate(card.cta_link);
              }
            }}
            className="snap-center shrink-0 w-full text-left"
          >
            <div className="relative aspect-[16/10] rounded-3xl overflow-hidden shadow-[0_8px_24px_-12px_hsl(0_0%_0%/0.25)] ring-1 ring-black/5">
              <img
                src={card.image_data_url}
                alt={card.title}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/70 via-black/30 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-5">
                <div className="inline-flex items-center gap-1 self-start bg-white/95 backdrop-blur-md text-[hsl(0,0%,9%)] text-[10px] font-black uppercase tracking-[0.14em] px-2 py-1 rounded-full mb-2 shadow">
                  <Sparkles className="h-3 w-3" strokeWidth={2.6} />
                  AI Pick
                </div>
                <h3 className="font-heading font-black text-white text-[22px] leading-[1.1] tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] max-w-[85%]">
                  {card.title}
                </h3>
                {card.subtitle && (
                  <p className="text-white/95 text-[12.5px] font-semibold mt-1 max-w-[85%] line-clamp-2 drop-shadow">
                    {card.subtitle}
                  </p>
                )}
                {card.cta_label && (
                  <span className="inline-flex items-center self-start mt-3 c-bg-accent rounded-full px-4 py-2 text-[12.5px] font-extrabold shadow-[0_4px_12px_-2px_hsl(var(--c-accent)/0.45)]">
                    {card.cta_label}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {cards.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {cards.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === active ? 'w-6 c-bg-accent' : 'w-1.5 bg-[hsl(0,0%,85%)]'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
