import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { Bell, RefreshCw, X } from 'lucide-react';
import { auth } from '../../utils/firebase';
import { useLocalFreelaCandidate } from '../modals/CanonicalFreelaWorkspace';
import { FreelancePersonalSummary } from './FreelancePersonalSummary';
import type { CourierActivityAlert } from '../../../shared/rendaActivityAlerts';
type Kind = 'delivery' | 'freelance';
const labels = { accepted: 'Corrida aceita', delivering: 'Entrega em andamento', done: 'Entrega concluída' };
export function RendaActivityAlertsBell({ kind, guestReadOnly, onLoginRequired }: {
  kind: Kind; guestReadOnly: boolean; onLoginRequired?: (reason:string)=>void;
}) {
  const [open,setOpen] = useState(false);
  const [uid,setUid] = useState('');
  const [alerts,setAlerts] = useState<CourierActivityAlert[]|null>(null);
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const [refreshKey,setRefreshKey] = useState(0);
  const generation = useRef(0);
  const candidate = useLocalFreelaCandidate();
  const name = kind === 'delivery' ? 'Entregas' : 'Freelas';
  useEffect(() => {
    let previous = auth.currentUser?.uid;
    return onAuthStateChanged(auth,user => {
      generation.current += 1;
      setAlerts(null); setUid(user?.uid ?? ''); setError(''); setLoading(false);
      if (previous !== user?.uid || !user) setOpen(false);
      previous = user?.uid;
    });
  },[]);
  useEffect(() => {
    const user = auth.currentUser;
    if (!open || kind !== 'delivery' || guestReadOnly || !uid || user?.uid !== uid) return;
    const ticket = ++generation.current;
    const abort = new AbortController();
    const active = () => generation.current === ticket && auth.currentUser?.uid === uid && !abort.signal.aborted;
    setAlerts(null);setError('');setLoading(true);
    void (async () => {
      const token = await user.getIdToken();
      if (!active()) return;
      const res = await fetch('/api/delivery-opportunities/alerts', {
        headers:{authorization:`Bearer ${token}`}, cache:'no-store', signal:abort.signal,
      });
      const body = await res.json().catch(()=>null);
      if (!res.ok || !Array.isArray(body?.alerts) || body.alerts.some((item: CourierActivityAlert) =>
        !item || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || !Object.hasOwn(labels,item.status))) {
        throw new Error('Não foi possível confirmar seus avisos de entregas.');
      }
      if (active()) setAlerts(body.alerts);
    })().catch(()=>{if(active())setError('Não foi possível confirmar seus avisos de entregas.');})
      .finally(()=>{if(active())setLoading(false);});
    return () => { generation.current += 1; abort.abort(); };
  },[open,kind,guestReadOnly,uid,refreshKey]);
  useEffect(()=>{
    if(!open)return;
    const previous = document.body.style.overflow;
    const close = (event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.body.style.overflow='hidden';
    window.addEventListener('keydown',close);
    return ()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',close);};
  },[open]);
  return <>
    <button type="button" id={kind+'-activity-alerts-trigger'} aria-label={'Avisos de '+name}
      aria-haspopup="dialog" aria-expanded={open}
      onClick={()=>{if(guestReadOnly || !auth.currentUser){onLoginRequired?.('consultar seus avisos');return;}setOpen(true);}}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/[0.08] text-orange-300">
      <Bell className="h-4 w-4"/>
    </button>
    {open && !guestReadOnly && uid && uid === auth.currentUser?.uid && createPortal(
      <div className="fixed inset-0 z-[180] flex items-end justify-center bg-slate-950/85 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={()=>setOpen(false)}>
        <section id={kind+'-activity-alerts-panel'} role="dialog" aria-modal="true" aria-label={'Avisos de '+name}
          className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-950 p-4 sm:max-w-lg sm:rounded-3xl"
          onMouseDown={e=>e.stopPropagation()}>
          <header className="flex items-center gap-3 border-b border-slate-800 pb-3">
            <Bell className="h-5 w-5 text-orange-400"/>
            <h2 className="flex-1 text-sm font-black text-white">Avisos de {name}</h2>
            {kind==='delivery' && <button type="button" aria-label="Atualizar avisos" disabled={loading}
              className="rounded-xl border border-slate-700 p-2 text-slate-300" onClick={()=>setRefreshKey(v=>v+1)}><RefreshCw className="h-4 w-4"/></button>}
            <button type="button" aria-label="Fechar avisos" className="p-2 text-slate-300" onClick={()=>setOpen(false)}><X className="h-5 w-5"/></button>
          </header>
          <div className="space-y-3 pt-3 text-xs text-slate-400" aria-live="polite">
            {kind==='delivery' ? <>
              <h3 className="font-bold text-white">Como entregador</h3>
              {loading && <p>Consultando corridas confirmadas...</p>}
              {error && <p role="alert" className="text-orange-300">{error}</p>}
              {alerts && alerts.length===0 && <p>Nenhuma corrida confirmada encontrada.</p>}
              {alerts?.map(item=><article key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                <p className="font-bold text-white">{labels[item.status]}</p>
                <p className="break-all text-[10px]">Referência: {item.id}</p>
              </article>)}
              <p>Estados confirmados de corridas; não são avisos não lidos nem comprovação de pagamento.</p>
              <h3 className="font-bold text-white">Como solicitante</h3>
              <p>Avisos do solicitante ainda não integrados.</p>
            </> : candidate ? <FreelancePersonalSummary view="alerts"/> : <>
              <h3 className="font-bold text-white">Como contratante e prestador</h3>
              <p>Os avisos confirmados de candidaturas, contratações e serviços ainda não estão disponíveis.</p>
              <p>Registros locais não são usados como confirmação de eventos de outras pessoas.</p>
            </>}
          </div>
        </section>
      </div>,document.body)}
  </>;
}
