import { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronUp, Images, Info, MessageCircle, ShieldCheck, Star, X } from 'lucide-react';
import type { Store } from '../types';
import { storeGalleryImages } from '../utils/storeMediaCollections';

export type StorefrontQuickSection = 'info'|'reservas'|'galeria'|'avaliacoes';
export const PUBLIC_STOREFRONT_QUICK_PANEL_ID = 'public-storefront-quick-panel';

type Props = {
  store: Store;
  selected: StorefrontQuickSection|null;
  onClose: () => void;
  onChat: () => void;
  onReviews: () => void;
  actionsDisabled: boolean;
};

/** Institutional information and photo gallery remain inside the same inline
 * accordion. Only already-public store media is presented to visitors.
 */
export function PublicStorefrontQuickPanel({
  store,selected,onClose,onChat,onReviews,actionsDisabled,
}:Props){
  const [openPhoto,setOpenPhoto] = useState<number|null>(null);
  const gallery = storeGalleryImages(store);
  useEffect(()=>setOpenPhoto(null),[selected,store.id]);
  if(!selected) return null;
  const titles:Record<StorefrontQuickSection,string>={
    info:'Informações da loja',
    reservas:'Reservas',
    galeria:'Galeria de imagens',
    avaliacoes:'Avaliações da loja',
  };
  return <>
    <section
      id={PUBLIC_STOREFRONT_QUICK_PANEL_ID}
      aria-label={titles[selected]}
      data-public-storefront-quick-section={selected}
      className="mx-auto mt-3 w-full rounded-2xl border border-orange-500/25 bg-slate-900/90 p-4 text-slate-100 shadow-xl sm:p-5"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-700 pb-3">
        <h2 className="text-sm font-black">{titles[selected]}</h2>
        <button type="button" onClick={onClose} aria-label="Recolher informações"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-200">
          <ChevronUp className="h-5 w-5"/>
        </button>
      </div>
      {selected==='info' && <div className="space-y-3 pt-3 text-xs leading-relaxed text-slate-300">
        <div className="flex items-center gap-2 text-orange-300">
          <Info className="h-4 w-4"/>
          <strong>{store.name}</strong>
        </div>
        {store.description
          ? <p className="whitespace-pre-wrap">{store.description}</p>
          : <p>A loja ainda não cadastrou uma apresentação institucional.</p>}
        {store.address && <p><strong className="text-white">Endereço: </strong>{store.address}</p>}
        {store.contact && <p><strong className="text-white">Contato: </strong>{store.contact}</p>}
        <p className="font-mono text-[10px] text-orange-300">kyrub.com/@{store.slug}</p>
        {!store.contact && <p className="text-slate-400">Para entrar em contato, utilize o chat da loja.</p>}
        {store.policies?.trim() && <div id="public-storefront-policies-inside-info"
          className="space-y-2 border-t border-slate-700 pt-4">
          <div className="flex items-center gap-2 font-bold text-orange-300">
            <ShieldCheck className="h-4 w-4"/> Políticas e condições
          </div>
          <p className="whitespace-pre-wrap break-words">{store.policies}</p>
        </div>}
      </div>}
      {selected==='reservas' && <div className="space-y-3 pt-4 text-xs leading-5">
        <div className="flex items-center gap-2 text-orange-300">
          <CalendarDays className="h-4 w-4"/>
          <strong>{store.reservationsEnabled===true ? 'Esta loja aceita solicitações de reservas.' : 'Esta loja não trabalha com reservas.'}</strong>
        </div>
        {store.reservationsEnabled===true && <>
          <p className="text-slate-300">Consulte datas, horários e disponibilidade diretamente com a loja. O pedido não representa uma reserva confirmada.</p>
          <button type="button" disabled={actionsDisabled} onClick={onChat}
            className="min-h-11 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 py-2 font-bold text-orange-200 disabled:opacity-50">
            Consultar reserva pelo chat
          </button>
        </>}
      </div>}
      {selected==='galeria' && <div className="space-y-3 pt-4">
        <div className="flex items-center gap-2 text-orange-300 text-xs font-bold">
          <Images className="h-4 w-4"/> Imagens do estabelecimento
        </div>
        {gallery.length===0
          ? <p className="text-xs text-slate-400">Esta loja ainda não adicionou imagens à galeria.</p>
          : <div id="public-storefront-gallery-grid" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {gallery.map((url,index)=><button key={url} type="button"
              onClick={()=>setOpenPhoto(index)}
              aria-label={`Ampliar foto ${index+1} de ${gallery.length}`}
              className="group relative h-32 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400 sm:h-44">
              <img src={url} alt={`Foto ${index+1} de ${store.name}`}
                loading="lazy" referrerPolicy="no-referrer"
                className="h-full w-full object-cover transition group-hover:scale-105"/>
              <span className="absolute bottom-1 right-1 rounded-full bg-slate-950/75 px-2 py-1 text-[10px] text-white">{index+1}/{gallery.length}</span>
            </button>)}
          </div>}
      </div>}
      {selected==='avaliacoes' && <div className="space-y-3 pt-4 text-xs leading-5">
        <div className="flex items-center gap-2 font-bold text-amber-200">
          <Star className="h-4 w-4"/> Avaliações e experiências
        </div>
        <p className="text-slate-300">Confira as avaliações publicadas por outros Kairubidos e participe com sua experiência.</p>
        <button type="button" onClick={onReviews} disabled={actionsDisabled}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 font-bold text-amber-200 disabled:opacity-50">
          <MessageCircle className="h-4 w-4"/> Ver avaliações e avaliar
        </button>
      </div>}
    </section>

    {selected==='galeria'&&openPhoto!==null&&gallery[openPhoto]&&<div
      role="dialog" aria-modal="true" aria-label={`Foto ${openPhoto+1} de ${store.name}`}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/95 p-4"
      onKeyDown={event=>{if(event.key==='Escape')setOpenPhoto(null);}}>
      <button type="button" autoFocus onClick={()=>setOpenPhoto(null)} aria-label="Fechar foto ampliada"
        className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-slate-900 text-white">
        <X className="h-5 w-5"/>
      </button>
      {gallery.length>1&&<button type="button" onClick={()=>setOpenPhoto(index=>(index===null?0:(index+gallery.length-1)%gallery.length))}
        aria-label="Foto anterior" className="absolute left-2 top-1/2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 text-white">
        <ChevronLeft className="h-5 w-5"/>
      </button>}
      <img src={gallery[openPhoto]} alt={`Imagem ampliada ${openPhoto+1} de ${store.name}`}
        referrerPolicy="no-referrer" className="max-h-[85vh] max-w-full rounded-lg object-contain"/>
      {gallery.length>1&&<button type="button" onClick={()=>setOpenPhoto(index=>(index===null?0:(index+1)%gallery.length))}
        aria-label="Próxima foto" className="absolute right-2 top-1/2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 text-white">
        <ChevronRight className="h-5 w-5"/>
      </button>}
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-100">
        {openPhoto+1} / {gallery.length}
      </span>
    </div>}
  </>;
}
