import { CalendarDays, ChevronUp, Info, ShieldCheck, Star, MessageCircle } from 'lucide-react';
import type { Store } from '../types';

export type StorefrontQuickSection = 'info'|'reservas'|'politicas'|'avaliacoes';
export const PUBLIC_STOREFRONT_QUICK_PANEL_ID = 'public-storefront-quick-panel';

type Props = {
  store: Store;
  selected: StorefrontQuickSection|null;
  onClose: () => void;
  onChat: () => void;
  onReviews: () => void;
  actionsDisabled: boolean;
};

/**
 * All public institutional information lives inline, immediately after the
 * banner; no second modal, no guest-only duplicate and no invented availability.
 */
export function PublicStorefrontQuickPanel({
  store,selected,onClose,onChat,onReviews,actionsDisabled,
}:Props){
  if(!selected) return null;
  const titles:Record<StorefrontQuickSection,string>={
    info:'Informações da loja',
    reservas:'Reservas',
    politicas:'Políticas da loja',
    avaliacoes:'Avaliações da loja',
  };
  return <section
    id={PUBLIC_STOREFRONT_QUICK_PANEL_ID}
    aria-label={titles[selected]}
    data-public-storefront-quick-section={selected}
    className="mx-auto mt-3 w-full rounded-2xl border border-orange-500/25 bg-slate-900/90 p-4 text-slate-100 shadow-xl sm:p-5"
  >
    <div className="flex items-center justify-between gap-3 border-b border-slate-700 pb-3">
      <h2 className="text-sm font-black">{titles[selected]}</h2>
      <button type="button" onClick={onClose}
        aria-label="Recolher informações"
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
    {selected==='politicas' && <div className="space-y-2 pt-4 text-xs leading-5">
      <div className="flex items-center gap-2 font-bold text-orange-300">
        <ShieldCheck className="h-4 w-4"/> Políticas e condições
      </div>
      <p className="text-slate-300">
        Esta loja ainda não publicou políticas institucionais específicas nesta vitrine.
        Consulte a loja antes de combinar condições de atendimento, entrega, troca ou cancelamento.
      </p>
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
  </section>;
}
