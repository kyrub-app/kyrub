import { useEffect, useMemo, useRef, useState } from 'react';
import { Store as StoreIcon } from 'lucide-react';
import { storeBannerImages } from '../utils/storeMediaCollections';

type StoreCardBannerCarouselProps = {
  name: string;
  logo?: string;
  banner?: string;
  bannerImages?: string[];
};

/**
 * Reuse the ordered public storefront banner media (maximum 5) without
 * creating another gallery or querying the merchant's private documents.
 * Pauses offscreen, in background tabs and for reduced-motion preferences.
 */
export function StoreCardBannerCarousel({
  name, logo = '', banner = '', bannerImages,
}: StoreCardBannerCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const images = useMemo(
    () => storeBannerImages({ banner, bannerImages }),
    [banner, bannerImages],
  );
  const mediaSignature = images.join('\u0000');
  const [broken, setBroken] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovered, setHovered] = useState(false);
  const visibleImages = images.filter(url => !broken.includes(url));
  const activeIndex = visibleImages.length ? index % visibleImages.length : 0;
  const selected = visibleImages[activeIndex];

  useEffect(() => {
    setIndex(0);
    setBroken([]);
  }, [mediaSignature]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      setInView(entries.some(entry => entry.isIntersecting));
    }, { threshold: 0.1 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const readVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    readVisibility();
    document.addEventListener('visibilitychange', readVisibility);
    const preference = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const readPreference = () => setReducedMotion(Boolean(preference?.matches));
    readPreference();
    preference?.addEventListener?.('change', readPreference);
    return () => {
      document.removeEventListener('visibilitychange', readVisibility);
      preference?.removeEventListener?.('change', readPreference);
    };
  }, []);

  useEffect(() => {
    if (visibleImages.length <= 1 || !inView || !pageVisible || reducedMotion || hovered) return;
    const timer = window.setInterval(
      () => setIndex(current => (current + 1) % visibleImages.length),
      5200,
    );
    return () => window.clearInterval(timer);
  }, [visibleImages.length, inView, pageVisible, reducedMotion, hovered]);

  return (
    <div ref={containerRef}
      data-store-card-banner="true"
      className="relative flex h-24 w-full items-center justify-center overflow-hidden bg-gradient-to-br from-sky-900/40 via-indigo-900/30 to-orange-900/20"
      aria-label={visibleImages.length > 1 ? `Destaques de ${name}` : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      {selected ? (
        <img key={selected} src={selected} alt="" aria-hidden="true" loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(current => current.includes(selected) ? current : [...current, selected])}
          className="absolute inset-0 h-full w-full object-cover" />
      ) : logo ? (
        <img src={logo} alt={name} className="h-14 w-14 rounded-xl object-cover"
          loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <StoreIcon className="h-10 w-10 text-orange-400" aria-hidden="true" />
      )}
      {visibleImages.length > 1 && (
        <span aria-hidden="true"
          className="pointer-events-none absolute bottom-1.5 left-2 rounded-full border border-white/15 bg-slate-950/75 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {activeIndex + 1}/{visibleImages.length}
        </span>
      )}
    </div>
  );
}
