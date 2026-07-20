import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCustomerAppConfig } from '@/hooks/useCustomerAppConfig';
import promoHero1 from '@/assets/promo-hero-1.jpg';
import promoHero2 from '@/assets/promo-hero-2.jpg';
import promoHero3 from '@/assets/promo-hero-3.jpg';

const HERO_IMAGES = [promoHero1, promoHero2, promoHero3];

export default function PromoBannerCarousel() {
  const cfg = useCustomerAppConfig();
  const promos = useMemo(
    () =>
      cfg.promos
        .filter((p) => p.enabled)
        .map((p, i) => ({
          tag: p.tag,
          title: p.title,
          subtitle: p.subtitle,
          code: p.code,
          image: HERO_IMAGES[i % HERO_IMAGES.length],
        })),
    [cfg.promos],
  );

  const [current, setCurrent] = useState(0);

  const next = useCallback(
    () => setCurrent((c) => (promos.length ? (c + 1) % promos.length : 0)),
    [promos.length],
  );

  useEffect(() => {
    if (promos.length <= 1) return;
    const t = setInterval(next, 5000);
    return () => clearInterval(t);
  }, [next, promos.length]);

  useEffect(() => {
    if (current >= promos.length) setCurrent(0);
  }, [promos.length, current]);

  if (promos.length === 0) return null;

  return (
    <div className="px-4 pt-3">
      <div className="relative overflow-hidden rounded-[22px] h-[170px] shadow-[0_10px_30px_-12px_hsl(0_0%_0%/0.25)] ring-1 ring-black/5">
        {promos.map((p, i) => (
          <div
            key={i}
            className={`absolute inset-0 transition-opacity duration-500 ${
              i === current ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <img
              src={p.image}
              alt={p.title}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent" />
            <div className="relative h-full p-5 flex flex-col justify-between">
              <div className="flex items-start justify-between">
                <span className="inline-flex items-center text-[10px] font-extrabold tracking-[0.18em] text-white bg-white/20 backdrop-blur-md rounded-full px-2.5 py-1">
                  {p.tag}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-white/80 bg-black/25 backdrop-blur-sm rounded-full px-2 py-0.5">
                  Promo
                </span>
              </div>
              <div className="max-w-[70%]">
                <h3 className="font-heading font-black text-white text-[22px] leading-[1.05] drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]">
                  {p.title}
                </h3>
                <p className="text-white/95 text-[13px] mt-0.5 drop-shadow">{p.subtitle}</p>
                {p.code && (
                  <div className="mt-2 inline-flex items-center gap-1.5">
                    <span className="text-[10px] text-white/85 uppercase tracking-wider font-semibold">
                      Κωδικός
                    </span>
                    <span className="text-[12px] font-extrabold text-white bg-black/40 px-2 py-0.5 rounded-md tracking-wide">
                      {p.code}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {promos.length > 1 && (
          <div className="absolute bottom-3 right-4 flex gap-1.5 z-10">
            {promos.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === current ? 'w-5 bg-white' : 'w-1.5 bg-white/50'
                }`}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
