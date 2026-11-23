import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Flame,
  MessageCircle,
  MessageSquareText,
  Store as StoreIcon,
} from 'lucide-react';
import type { Store } from '../types';

type PublicStorefrontHeroProps = {
  store: Store;
  movementLabel: string;
  movementColorClassName: string;
  actionsDisabled: boolean;
  onOpenInfo: () => void;
  onClose: () => void;
  onReviews: () => void;
  onChat: () => void;
};

/**
 * A single public hero shared by guest and signed-in storefront views.
 * Commerce, products, chat, reviews, and store information remain owned by
 * their existing application services; this component owns presentation only.
 */
export function PublicStorefrontHero({
  store,
  movementLabel,
  movementColorClassName,
  actionsDisabled,
  onOpenInfo,
  onClose,
  onReviews,
  onChat,
}: PublicStorefrontHeroProps) {
  const images = useMemo(
    () => Array.from(new Set(
      [store.banner, ...(store.offerImages ?? [])]
        .map(value => typeof value === 'string' ? value.trim() : '')
        .filter(Boolean)
    )),
    [store.banner, store.offerImages]
  );
  const [imageIndex, setImageIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => { setImageIndex(0); }, [store.id]);
  useEffect(() => {
    if (images.length <= 1) return;
    const timer = window.setInterval(
      () => setImageIndex(index => (index + 1) % images.length),
      5200
    );
    return () => window.clearInterval(timer);
  }, [images.length]);

  const previous = () => setImageIndex(index => (index + images.length - 1) % images.length);
  const next = () => setImageIndex(index => (index + 1) % images.length);
  const endTouch = (clientX: number) => {
    if (touchStartX !== null && images.length > 1) {
      const delta = clientX - touchStartX;
      if (Math.abs(delta) >= 42) {
        if (delta < 0) next();
        else previous();
      }
    }
    setTouchStartX(null);
  };

  return (
    <section
      id="public-storefront-hero"
      data-kyrub-public-storefront-hero="full-banner"
      className="relative isolate h-[390px] min-h-[330px] overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950 shadow-2xl sm:h-[460px]"
    >
      <div
        id="storefront-banner"
        className="absolute inset-0"
        aria-label={`Destaques de ${store.name}`}
        aria-roledescription="carrossel"
        onTouchStart={event => setTouchStartX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={event => endTouch(event.changedTouches[0]?.clientX ?? 0)}
        onTouchCancel={() => setTouchStartX(null)}
      >
        {images.length > 0 ? (
          images.map((image, index) => (
            <img
              key={image}
              src={image}
              alt={index === imageIndex ? `Destaque ${index + 1} de ${store.name}` : ''}
              aria-hidden={index !== imageIndex}
              referrerPolicy="no-referrer"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${index === imageIndex ? 'opacity-100' : 'opacity-0'}`}
            />
          ))
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at top right, ${store.primaryColor || '#f97316'}, transparent 60%), linear-gradient(145deg, #020617, #0d1714)`,
            }}
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/15 to-slate-950/45" />
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={previous}
              aria-label="Imagem anterior"
              className="absolute left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-slate-950/65 text-white backdrop-blur-md sm:flex"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Próxima imagem"
              className="absolute right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-slate-950/65 text-white backdrop-blur-md sm:flex"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div
              className="absolute inset-x-0 bottom-[96px] z-10 flex items-center justify-center gap-2 sm:bottom-[104px]"
              aria-label={`${imageIndex + 1} de ${images.length}`}
            >
              {images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setImageIndex(index)}
                  aria-label={`Abrir destaque ${index + 1}`}
                  aria-current={index === imageIndex ? 'true' : undefined}
                  className={`h-2 rounded-full transition-all ${index === imageIndex ? 'w-7 bg-orange-400' : 'w-2.5 bg-white/60'}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 p-4 sm:p-5">
        <span
          className="min-w-0 max-w-[calc(100%-4rem)] truncate rounded-full border border-white/10 bg-slate-950/60 px-3 py-2 font-mono text-[9px] font-black uppercase tracking-wider text-orange-200 shadow-lg backdrop-blur-md sm:text-xs"
        >
          kyrub.com/@{store.slug}
        </span>
        <button
          id="public-storefront-close"
          type="button"
          onClick={onClose}
          aria-label="Voltar"
          className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-slate-950/70 text-white shadow-lg backdrop-blur-md transition hover:border-orange-400"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 pb-4 sm:p-5 sm:pb-6">
        <div className="flex min-w-0 items-end gap-2 sm:gap-3">
          <button
            id="public-storefront-header-info-trigger"
            type="button"
            onClick={onOpenInfo}
            aria-label={`Abrir informações públicas de ${store.name}`}
            className="pointer-events-auto relative shrink-0 rounded-2xl outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            {store.logo ? (
              <img
                src={store.logo}
                alt={`Logo de ${store.name}`}
                referrerPolicy="no-referrer"
                className="h-14 w-14 rounded-2xl border-2 border-white/20 bg-slate-900 object-cover shadow-xl sm:h-[72px] sm:w-[72px]"
              />
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-white/20 bg-orange-500 text-slate-950 shadow-xl sm:h-[72px] sm:w-[72px]">
                <StoreIcon className="h-7 w-7" />
              </span>
            )}
            <span
              id="public-storefront-header-info-badge"
              aria-hidden="true"
              className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-slate-950 bg-white text-[11px] font-black leading-none text-slate-950 shadow-lg"
            >
              i
            </span>
          </button>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h1 className="min-w-0 line-clamp-2 text-sm font-black leading-tight text-white drop-shadow-lg sm:text-xl">
                {store.name || 'Loja sem nome'}
              </h1>
              <span className={`shrink-0 ${movementColorClassName}`} title={movementLabel}>
                <Flame className="h-4 w-4 fill-current sm:h-5 sm:w-5" aria-hidden="true" />
                <span className="sr-only">{movementLabel}</span>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pb-1">
            <button
              id="public-storefront-reviews-trigger"
              type="button"
              onClick={onReviews}
              disabled={actionsDisabled}
              aria-label="Ver avaliações e avaliar esta loja"
              title="Avaliações"
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-amber-400/40 bg-slate-950/75 text-amber-200 shadow-lg backdrop-blur-md transition hover:bg-slate-900 disabled:opacity-50"
            >
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              id="customer-store-chat-launcher"
              type="button"
              onClick={onChat}
              disabled={actionsDisabled}
              aria-label={`Conversar com ${store.name || 'a loja'}`}
              title="Conversar com a loja"
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-orange-400/40 bg-slate-950/75 text-orange-200 shadow-lg backdrop-blur-md transition hover:bg-slate-900 disabled:opacity-50"
            >
              <MessageSquareText className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
