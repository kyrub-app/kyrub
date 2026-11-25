import { useEffect, useRef, useState } from 'react';
import { createSemeaduraReadCoalescer } from '../../utils/semeaduraReadCoalescer';
import { auth } from '../../utils/firebase';
import { SemeaduraJourneyPanel } from '../SemeaduraJourneyPanel';

type Account = { pitangas: number; xp: number; initialized: boolean; entries: { id: string; unit: string; delta: number; occurredAt: string }[] };

const accountReads=createSemeaduraReadCoalescer<Account>();
const STATEMENT_PAGE_SIZE=20;
export function PitangaAccount({mode='all'}:{mode?:'all'|'pitangas'|'xp'}) {
  const [session,setSession]=useState(auth.currentUser);
  useEffect(()=>auth.onAuthStateChanged(setSession),[]);
  return <ScopedPitangaAccount key={session?.uid??''} session={session} mode={mode}/>;
}
function ScopedPitangaAccount({mode,session}:{mode:'all'|'pitangas'|'xp';session:typeof auth.currentUser}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState('Consultando recompensas…');
  const [busy, setBusy] = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [visibleEntries,setVisibleEntries]=useState(STATEMENT_PAGE_SIZE);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const controller=new AbortController();
    let revision=0;
    const read = async (force=false) => {
      const attempt=++revision;
      const current=()=>!controller.signal.aborted&&auth.currentUser===session&&attempt===revision;
      try {
        if(!session||!current())throw Error();
        if(force)accountReads.invalidate(session,'account');
        const data=await accountReads.read(session,'account',async signal=>{
          if(auth.currentUser!==session||signal.aborted)throw Error();
          const token=await session.getIdToken();
          if(!token||auth.currentUser!==session||signal.aborted)throw Error();
          const response=await fetch('/api/pitangas',{headers:{authorization:`Bearer ${token}`},cache:'no-store',credentials:'omit',redirect:'error',signal});
          if(!response.ok)throw Error();
          const result=await response.json() as Account;
          if(auth.currentUser!==session||signal.aborted||!Number.isSafeInteger(result.pitangas)||result.pitangas<0||!Number.isSafeInteger(result.xp)||result.xp<0||!Array.isArray(result.entries))throw Error();
          return result;
        },controller.signal);
        if(current()){setAccount(data);setMessage('');setVisibleEntries(STATEMENT_PAGE_SIZE);}
      }catch{if(current()){setAccount(null);setMessage('Recompensas indisponíveis. Tente atualizar novamente.');}}
    };
    setAccount(null);setMessage('Consultando recompensas…');setShowStatement(false);
    requestId.current=null;
    reload.current=()=>read(true);
    void read();
    return ()=>controller.abort();
  }, [session]);

  const convert = async () => {
    if (inFlight.current||!session||auth.currentUser!==session) return;
    inFlight.current = true; setBusy(true);
    // Preserve the key after an ambiguous network failure; retry cannot debit twice.
    requestId.current ??= crypto.randomUUID();
    try {
      accountReads.invalidate(session,'account');
      const token=await session.getIdToken();
      if(!token||auth.currentUser!==session)throw Error();
      const response = await fetch('/api/pitangas', { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: requestId.current, requestedXp: 1 }),
        credentials:'omit',redirect:'error',cache:'no-store',
      });
      if(auth.currentUser!==session)return;
      if (!response.ok) {
        setMessage(response.status === 409 ? 'Saldo insuficiente ou solicitação em conflito. Atualize o extrato.' : 'Conversão indisponível. Você pode tentar novamente com segurança.');
        return;
      }
      requestId.current = null;
      await reload.current();
      if(auth.currentUser===session)setMessage('Conversão confirmada: 1.000 Pitangas por 1 XP.');
    } catch { if(auth.currentUser===session)setMessage('Não foi possível confirmar. Tente novamente para consultar a mesma conversão.'); }
    finally { accountReads.invalidate(session,'account');inFlight.current = false; setBusy(false); }
  };

  return <div className="space-y-3">
    {mode !== 'xp' && (
      <h3 className="text-lg font-bold text-white">
        {mode === 'pitangas' ? 'Minhas Pitangas' : 'Pitangas e XP'}
      </h3>
    )}
    {mode === 'xp' && (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 p-3"
        aria-label="Saldo de Pitangas creditadas">
        <span className="text-sm font-semibold text-slate-300">Pitangas disponíveis</span>
        <strong className="text-base font-bold tabular-nums text-orange-300">
          {account ? account.pitangas.toLocaleString('pt-BR') : '…'} Pitangas
        </strong>
      </div>
    )}
    {mode !== 'pitangas' && (
      <SemeaduraJourneyPanel
        viewerId={auth.currentUser?.uid || ''}
        xp={mode === 'xp' ? (account?.xp ?? null) : undefined}
      />
    )}
    {account && mode !== 'xp' && (
      <p className="text-sm text-slate-200">
        {mode === 'pitangas'
          ? `${account.pitangas.toLocaleString('pt-BR')} Pitangas`
          : `${account.pitangas.toLocaleString('pt-BR')} Pitangas · ${account.xp.toLocaleString('pt-BR')} XP`}
      </p>
    )}
    <p className="text-sm leading-relaxed text-slate-400">
      100 Pitangas no primeiro cadastro elegível. Primeira loja publicada: 2 XP.
      Conversão voluntária: 1.000 Pitangas = 1 XP.
      {mode === 'xp' && ' O saldo de Pitangas creditadas não se confunde com sementes ou equivalências visuais da jornada.'}
    </p>
    <div className="flex flex-wrap gap-2">
      <button type="button"
        disabled={busy || !account?.initialized || (account.pitangas < 1000 && !requestId.current)}
        onClick={() => void convert()}
        className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm disabled:opacity-50">
        {busy ? 'Confirmando…' : requestId.current ? 'Consultar / tentar novamente' : 'Converter 1.000 Pitangas em 1 XP'}
      </button>
      <button type="button" onClick={() => setShowStatement(!showStatement)} aria-expanded={showStatement}
        className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm">Extrato</button>
      <button type="button" disabled={busy} onClick={() => void reload.current()}
        className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm">Atualizar</button>
    </div>
    {message && <p role="status" className="text-sm text-slate-300">{message}</p>}
    {showStatement && account && (
      <ul aria-label="Extrato de recompensas" className="space-y-2 text-sm">
        {account.entries.length === 0 && <li>Nenhum lançamento.</li>}
        {account.entries.slice(0,visibleEntries).map(e => (
          <li key={`${e.unit}:${e.id}`}>
            {new Date(e.occurredAt).toLocaleString('pt-BR')} · {e.delta > 0 ? '+' : ''}{e.delta} {e.unit === 'xp' ? 'XP' : 'Pitangas'}
          </li>
        ))}
        {account.entries.length>visibleEntries&&<li><button type="button" onClick={()=>setVisibleEntries(n=>n+STATEMENT_PAGE_SIZE)} className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm">Mostrar mais lançamentos</button></li>}
      </ul>
    )}
  </div>;
}
