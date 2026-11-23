import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Info,
  Images, MessageSquareText, Share2,
  Star, Store as StoreIcon,
} from 'lucide-react';
import type { Store } from '../types';
import type { StorefrontQuickSection } from './PublicStorefrontQuickPanel';
import { storeBannerImages } from '../utils/storeMediaCollections';

type PublicStorefrontHeroProps = {
  store: Store;
  selectedSection: StorefrontQuickSection | null;
  actionsDisabled: boolean;
  onSelectSection: (section: StorefrontQuickSection) => void;
  onChat: () => void;
  onShare: () => void;
};

const sections: {
  id: StorefrontQuickSection | 'chat' | 'share';
  label: string;
  Icon: typeof Info;
}[] = [
  {id:'info',label:'Informações',Icon:Info},
  {id:'reservas',label:'Reservas',Icon:CalendarDays},
  {id:'galeria',label:'Galeria',Icon:Images},
  {id:'avaliacoes',label:'Avaliações',Icon:Star},
  {id:'chat',label:'Conversar',Icon:MessageSquareText},
  {id:'share',label:'Compartilhar',Icon:Share2},
];

/** Public customer storefront: visual logo on top and horizontally
 * scrollable action icons along the banner footer. The existing catalog
 * and canonical data APIs remain unchanged.
 */
export function PublicStorefrontHero({
  store, selectedSection, actionsDisabled, onSelectSection, onChat, onShare,
}: PublicStorefrontHeroProps) {
  const images = useMemo(() => storeBannerImages(store), [store.banner, store.bannerImages]);
  const [imageIndex, setImageIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  useEffect(() => { setImageIndex(0); }, [store.id]);
  useEffect(() => {
    if (images.length <= 1) return;
    const timer = window.setInterval(
      () => setImageIndex(index => (index + 1) % images.length), 5200
    );
    return () => window.clearInterval(timer);
  }, [images.length]);

  const previous = () => setImageIndex(index => (index + images.length - 1) % images.length);
  const next = () => setImageIndex(index => (index + 1) % images.length);
  const endTouch = (clientX: number) => {
    if (touchStartX !== null && images.length > 1) {
      const delta = clientX - touchStartX;
      if (Math.abs(delta) >= 42) delta < 0 ? next() : previous();
    }
    setTouchStartX(null);
  };

  return (
    <section id="public-storefront-hero"
      data-kyrub-public-storefront-hero="full-banner"
      className="relative isolate h-[390px] min-h-[330px] overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-950 shadow-2xl sm:h-[460px]">
      <div id="storefront-banner" className="absolute inset-0"
        aria-label={`Destaques de ${store.name}`}
        aria-roledescription="carrossel"
        onTouchStart={event => setTouchStartX(event.touches[0]?.clientX ?? null)}
        onTouchEnd={event => endTouch(event.changedTouches[0]?.clientX ?? 0)}
        onTouchCancel={() => setTouchStartX(null)}>
        {images.length ? images.map((image,index) => (
          <img key={image} src={image}
            alt={index === imageIndex ? `Destaque ${index + 1} de ${store.name}` : ''}
            aria-hidden={index !== imageIndex}
            referrerPolicy="no-referrer"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${index === imageIndex ? 'opacity-100' : 'opacity-0'}`}/>
        )) : (
          <div className="absolute inset-0"
            style={{background:`radial-gradient(circle at top right, ${store.primaryColor || '#f97316'}, transparent 60%), linear-gradient(145deg, #020617, #0d1714)`}}/>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/10 to-slate-950/45"/>
        {images.length > 1 && <>
          <button type="button" onClick={previous} aria-label="Imagem anterior"
            className="absolute left-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-slate-950/65 text-white sm:flex">
            <ChevronLeft className="h-5 w-5"/>
          </button>
          <button type="button" onClick={next} aria-label="Próxima imagem"
            className="absolute right-3 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-slate-950/65 text-white sm:flex">
            <ChevronRight className="h-5 w-5"/>
          </button>
          <div className="absolute inset-x-0 bottom-[98px] z-10 flex items-center justify-center gap-2"
            aria-label={`${imageIndex + 1} de ${images.length}`}>
            {images.map((image,index)=>(
              <button type="button" key={image} onClick={()=>setImageIndex(index)}
                aria-label={`Abrir destaque ${index+1}`}
                aria-current={index===imageIndex?'true':undefined}
                className={`h-2 rounded-full transition-all ${index===imageIndex?'w-7 bg-orange-400':'w-2.5 bg-white/60'}`}/>
            ))}
          </div>
        </>}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex min-w-0 items-center gap-2 p-3 sm:p-5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-orange-500 shadow-lg sm:h-14 sm:w-14"
          aria-label={`Identidade visual de ${store.name}`}>
          {store.logo
            ? <img src={store.logo} alt={`Logo de ${store.name}`} referrerPolicy="no-referrer"
                className="h-full w-full object-cover"/>
            : <StoreIcon className="h-7 w-7 text-slate-950"/>}
        </div>
        <span className="min-w-0 max-w-[calc(100%-4rem)] truncate rounded-full border border-white/10 bg-slate-950/65 px-3 py-2 font-mono text-[10px] font-black uppercase tracking-wide text-orange-200 shadow-lg backdrop-blur-md sm:text-xs">
          kyrub.com/@{store.slug}
        </span>
      </div>

      <nav aria-label="Atalhos da loja" className="absolute inset-x-0 bottom-0 z-20 p-3 sm:p-5">
        <div className="flex w-full snap-x snap-mandatory gap-2 overflow-x-auto rounded-2xl bg-slate-950/55 px-2 py-2 backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onTouchStart={event=>event.stopPropagation()}
          onTouchEnd={event=>event.stopPropagation()}>
          {sections.map(({id,label,Icon})=>{
            const expandable = id !== 'chat' && id !== 'share';
            const active = expandable && selectedSection===id;
            return (
              <button type="button" key={id}
                id={id==='chat'?'customer-store-chat-launcher':id==='avaliacoes'?'public-storefront-reviews-trigger':`public-storefront-action-${id}`}
                disabled={actionsDisabled}
                aria-label={label}
                aria-expanded={expandable ? active : undefined}
                aria-controls={expandable?'public-storefront-quick-panel':undefined}
                onClick={()=>{
                  if(id==='chat')onChat();
                  else if(id==='share')onShare();
                  else onSelectSection(id);
                }}
                className="flex min-w-[64px] shrink-0 snap-center flex-col items-center gap-1 text-orange-100 disabled:opacity-50">
                <span className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-lg transition ${active?'border-orange-400 bg-orange-500 text-slate-950':'border-orange-400/40 bg-slate-950/70 text-orange-200 hover:border-orange-300'}`}>
                  <Icon className="h-5 w-5" aria-hidden="true"/>
                </span>
                <span className="text-[9px] font-semibold leading-tight text-white">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </section>
  );
}
