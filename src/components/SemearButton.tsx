import { useCallback, useEffect, useRef, useState } from 'react';
import { createSemeaduraReadCoalescer } from '../utils/semeaduraReadCoalescer';
import { auth } from '../utils/firebase';
import { SEMEADURA_DAILY_LIMIT, semeaduraDay, mergeSemeaduraDailyAllowance, type SemeaduraDailyAllowance } from '../../shared/semeaduraDailyLimit';
import { calculatePitangueiraJourney, SEEDS_PER_BOSQUE, type SemeaduraPostKind } from '../../shared/pitangueiraJourney';

export const SEMEADURA_UI_ENABLED = import.meta.env?.VITE_SEMEADURA_UI_ENABLED === 'true';

type SemeaduraStatus = {
  count: number;
  closed: boolean;
  seeded: boolean;
  canSemear: boolean;
  authorId: string;
  pitangueiras: number;
  bosqueCompleted: boolean;
  dailyDay:string;
  dailyRemaining:number;
};

class SemeaduraQuotaReached extends Error {
  constructor(readonly dailyDay:string){super('SEMEADURA_DAILY_LIMIT_REACHED');}
}
const sharedReads=createSemeaduraReadCoalescer<Record<string, unknown>>();
export async function requestSemeadura(
  action: 'status' | 'semear' | 'journey',
  target?: {kind:SemeaduraPostKind;postId:string},signal?:AbortSignal,expectedUid?:string,
):Promise<Record<string,unknown>> {
  const session=auth.currentUser;
  if(!session||signal?.aborted||(expectedUid!==undefined&&session.uid!==expectedUid))throw Error('SEMEADURA_SESSION_CHANGED');
  const key=JSON.stringify([action==='journey'?'journey':'status',target?.kind,target?.postId,semeaduraDay(new Date())]);
  if(action==='semear'){
    sharedReads.invalidate(session,key);
    try{return await requestSemeaduraTransport(action,target,signal,session.uid);}
    finally{sharedReads.invalidate(session,key);}
  }
  const result=await sharedReads.read(session,key,sharedSignal=>{
    if(auth.currentUser!==session)throw Error('SEMEADURA_SESSION_CHANGED');
    return requestSemeaduraTransport(action,target,sharedSignal,session.uid);
  },signal);
  if(auth.currentUser!==session||signal?.aborted)throw Error('SEMEADURA_SESSION_CHANGED');
  return result;
}
async function requestSemeaduraTransport(
  action: 'status' | 'semear' | 'journey',
  target?: { kind: SemeaduraPostKind; postId: string },
  signal?: AbortSignal,
  expectedUid?: string,
): Promise<Record<string, unknown>> {
  const session=auth.currentUser;
  const requireCurrent=()=>{
    if(!session||auth.currentUser!==session||signal?.aborted||(expectedUid!==undefined&&session.uid!==expectedUid))throw Error('SEMEADURA_SESSION_CHANGED');
  };
  requireCurrent();
  const token = await session!.getIdToken();
  requireCurrent();
  if (!token) throw new Error('Faça login para semear.');
  const response = await fetch('/api/action-execute?transport=semeadura', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...(target ?? {}) }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  requireCurrent();
  if(response.status===429){
    const failure=await response.json().catch(()=>null);
    requireCurrent();
    if(failure?.error==='SEMEADURA_DAILY_LIMIT_REACHED'&&failure.dailyRemaining===0&&
        typeof failure.dailyDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(failure.dailyDay))
      throw new SemeaduraQuotaReached(failure.dailyDay);
    throw Error('Semeadura temporariamente indisponível.');
  }
  if (!response.ok) throw new Error(
    response.status === 409
      ? 'Esta publicação não aceita semeaduras agora.'
      : 'Semeadura indisponível. Tente novamente.',
  );
  const result=await response.json() as Record<string, unknown>;
  requireCurrent();
  return result;
}

const normalizeSemeadura = (raw: Record<string, unknown>): SemeaduraStatus => {
  const count = raw.count;
  if (!Number.isSafeInteger(count) || Number(count) < 0 ||
      Number(count) > SEEDS_PER_BOSQUE ||
      typeof raw.authorId !== 'string' ||
      typeof raw.closed !== 'boolean' ||
      typeof raw.seeded !== 'boolean' ||
      typeof raw.canSemear !== 'boolean' ||
      raw.closed !== (count === SEEDS_PER_BOSQUE) ||
      typeof raw.dailyDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.dailyDay)||
      typeof raw.dailyRemaining!=='number'||!Number.isSafeInteger(raw.dailyRemaining)||raw.dailyRemaining<0||raw.dailyRemaining>SEMEADURA_DAILY_LIMIT||
      ((raw.dailyRemaining===0||raw.seeded||raw.closed)&&raw.canSemear)) {
    throw new Error('Resposta de semeadura inconsistente.');
  }
  return {
    count: Number(count),
    dailyDay:raw.dailyDay,dailyRemaining:raw.dailyRemaining,
    closed: raw.closed,
    seeded: raw.seeded,
    canSemear: raw.canSemear,
    authorId: raw.authorId,
    pitangueiras: Math.floor(Number(count) / 1000),
    bosqueCompleted: raw.closed,
  };
};

type SemearButtonProps = {
  kind: SemeaduraPostKind;
  postId: string;
  viewerId: string;
  className?: string;
  compact?: boolean;
};
export function SemearButton(props: SemearButtonProps) {
  // Isolate receipt state and in-flight responses across accounts and posts.
  return <ScopedSemearButton key={JSON.stringify([props.viewerId,props.kind,props.postId])} {...props} />;
}
function ScopedSemearButton({
  kind, postId, viewerId, className, compact = false,
}: SemearButtonProps) {
  const [state, setState] = useState<SemeaduraStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);
  const source=useRef({});
  const allowanceRef=useRef<SemeaduraDailyAllowance|null>(null);
  const observeAllowance=useCallback((next:SemeaduraDailyAllowance)=>{
    const current=mergeSemeaduraDailyAllowance(allowanceRef.current,next);
    allowanceRef.current=current;
    return current;
  },[]);

  useEffect(() => {
    const target = holderRef.current;
    if (!target) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [kind, postId]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!viewerId || auth.currentUser?.uid !== viewerId) return;
    const next = normalizeSemeadura(await requestSemeadura('status', { kind, postId }, signal, viewerId));
    if (!signal?.aborted && auth.currentUser?.uid === viewerId) {
      const allowance=observeAllowance(next);
      setState(previous=>{
        const count=Math.max(previous?.count??0,next.count);
        const seeded=Boolean(previous?.seeded||next.seeded);
        const closed=Boolean(previous?.closed||next.closed);
        return {...next,...allowance,count,seeded,closed,bosqueCompleted:closed,pitangueiras:Math.floor(count/1000),
          canSemear:next.canSemear&&!seeded&&!closed&&allowance.dailyRemaining>0&&next.dailyDay===allowance.dailyDay};
      });
      setError('');
      if(allowance.dailyRemaining===0)window.dispatchEvent(new CustomEvent('kyrub-semeadura-quota-exhausted',{detail:{viewerId,day:allowance.dailyDay}}));
    }
  }, [kind, postId, viewerId,observeAllowance]);

  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setError('');
    if (viewerId && visible) {
      void refresh(controller.signal).catch(() => {
        if (!controller.signal.aborted) setError('Não foi possível carregar as sementes.');
      });
    }
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; postId?: string; source?:object; viewerId?:string }>).detail;
      if(detail?.source===source.current||detail?.viewerId!==viewerId)return;
      if (detail?.kind === kind && detail.postId === postId && viewerId && visible) {
        void refresh(controller.signal).catch(() => undefined);
      }
    };
    const quotaExhausted=(event:Event)=>{
      const detail=(event as CustomEvent<{viewerId?:string;day?:string}>).detail;
      if(detail?.viewerId!==viewerId||auth.currentUser?.uid!==viewerId||typeof detail.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(detail.day))return;
      const allowance=observeAllowance({dailyDay:detail.day,dailyRemaining:0});
      if(allowance.dailyRemaining===0)setState(previous=>previous?{...previous,...allowance,canSemear:false}:previous);
    };
    window.addEventListener('kyrub-semeadura-updated', sync);
    window.addEventListener('kyrub-semeadura-quota-exhausted',quotaExhausted);
    return () => {
      controller.abort();
      window.removeEventListener('kyrub-semeadura-updated', sync);
      window.removeEventListener('kyrub-semeadura-quota-exhausted',quotaExhausted);
    };
  }, [kind, postId, viewerId, visible, refresh,observeAllowance]);

  // Only exhausted, visible cards need automatic recovery on a new day.
  // The browser clock only triggers a status read; never grants allowance.
  useEffect(()=>{
    if(!visible||!viewerId||!state||state.dailyRemaining!==0||state.seeded||state.closed)return;
    const controller=new AbortController();
    const checkDay=()=>{if(semeaduraDay(new Date())!==state.dailyDay)void refresh(controller.signal).catch(()=>undefined);};
    const timer=window.setInterval(checkDay,30000);
    window.addEventListener('focus',checkDay);
    document.addEventListener('visibilitychange',checkDay);
    checkDay();
    return ()=>{controller.abort();window.clearInterval(timer);window.removeEventListener('focus',checkDay);document.removeEventListener('visibilitychange',checkDay);};
  },[visible,viewerId,state?.dailyDay,state?.dailyRemaining,state?.seeded,state?.closed,refresh]);

  const semear = async () => {
    if (!state?.canSemear || state.seeded || inFlight.current || !viewerId || auth.currentUser?.uid!==viewerId) return;
    const session=auth.currentUser;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await requestSemeadura('semear', { kind, postId }, undefined, viewerId);
      if (result.status !== 'accepted' && result.status !== 'already_seeded' &&
          result.status !== 'closed') {
        throw new Error('Resultado de semeadura desconhecido.');
      }
      // The authenticated server has confirmed an irreversible receipt.
      // Lock immediately, even if the follow-up read fails or is stale.
      if(auth.currentUser!==session||auth.currentUser?.uid!==viewerId)return;
      if(result.status==='accepted'||result.status==='already_seeded'){
        setState(previous=>previous?{...previous,seeded:true,canSemear:false}:previous);
      }else{
        setState(previous=>previous?{...previous,canSemear:false}:previous);
      }
      // Query the authoritative status after the write. Never infer account
      // awards or allow an optimistic increment on a potentially failed write.
      try {
        if(result.status==='accepted'&&typeof result.dailyDay==='string'&&typeof result.dailyRemaining==='number'){
          const confirmed=normalizeSemeadura({...result,seeded:true,canSemear:false});
          const allowance=observeAllowance(confirmed);
          setState(previous=>({...confirmed,...allowance,count:Math.max(previous?.count??0,confirmed.count),
            closed:Boolean(previous?.closed||confirmed.closed),seeded:true,canSemear:false}));
          if(allowance.dailyRemaining===0)window.dispatchEvent(new CustomEvent('kyrub-semeadura-quota-exhausted',{detail:{viewerId,day:allowance.dailyDay}}));
        }else await refresh();
      } catch {
        // An accepted write is not a failure when the follow-up status read
        // times out. The immutable receipt prevents duplicate seed credits.
        if(auth.currentUser===session)setError('Semente recebida; o progresso ainda não foi atualizado.');
      }
      if(auth.currentUser!==session)return;
      window.dispatchEvent(new CustomEvent('kyrub-semeadura-updated', {
        detail: { kind, postId, viewerId, source:source.current },
      }));
    } catch (failure) {
      if(auth.currentUser!==session)return;
      if(failure instanceof SemeaduraQuotaReached&&auth.currentUser?.uid===viewerId){
        const allowance=observeAllowance({dailyDay:failure.dailyDay,dailyRemaining:0});
        if(allowance.dailyRemaining===0)setState(previous=>previous?{...previous,...allowance,canSemear:false}:previous);
        window.dispatchEvent(new CustomEvent('kyrub-semeadura-quota-exhausted',{detail:{viewerId,day:failure.dailyDay}}));
        setError('Limite de 100 sementes por dia atingido. Volte amanhã (horário de Brasília).');
      }else setError('Não foi possível semear. Tente novamente.');
      await refresh().catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const journey = calculatePitangueiraJourney(state?.count ?? 0);
  const label = state?.closed
    ? 'Bosque concluído'
    : state?.seeded
      ? 'Semeado'
      : state?.authorId === viewerId
        ? 'Sua publicação'
        : state?.dailyRemaining===0
          ? 'Limite diário atingido'
          : state && !state.canSemear
          ? 'Participe para semear'
          : 'Semear';
  const compactLabel = state?.closed ? 'Concluído' : state?.seeded ? 'Semeado' : state?.dailyRemaining===0 ? 'Limite diário' : 'Semear';
  return (
    <div ref={holderRef} className="min-w-0">
      <button type="button"
        aria-label={`${label} · ${state?.count ?? 0} sementes recebidas`}
        aria-description="Semear é definitivo e não pode ser desfeito. Até 100 sementes enviadas por dia; renovação à meia-noite no horário de Brasília."
        aria-pressed={Boolean(state?.seeded)}
        title={`${(state?.count ?? 0).toLocaleString('pt-BR')} de ${SEEDS_PER_BOSQUE.toLocaleString('pt-BR')} sementes · ${journey.pitangueiras} pitangueiras · teto de 1 bosque por publicação · Semear é definitivo e não pode ser desfeito${state ? ' · '+state.dailyRemaining+' de 100 sementes disponíveis hoje' : ''}`}
        disabled={!state || !state.canSemear || state.seeded || busy || !viewerId}
        onClick={() => void semear()}
        className={className ?? 'flex min-h-11 w-full min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-2 text-xs font-bold text-emerald-300 disabled:opacity-60'}>
        {!compact && (state?.closed ? (
          <span aria-hidden="true" title="Bosque concluído">🌲</span>
        ) : (
          <img src="/kyrub-pitanga-seed.svg" alt="" aria-hidden="true" title="Semente da pitangueira" className="h-[18px] w-[18px] shrink-0 object-contain" />
        ))}
        <span className={compact ? 'whitespace-nowrap' : 'truncate'}>{compact
          ? compactLabel
          : !viewerId ? 'Entre para semear' : !visible || !state ? 'Sementes…' : label + ' · ' + state.count.toLocaleString('pt-BR')}</span>
      </button>
      {error && <p role="status" className="mt-1 text-[10px] text-amber-300">{error}</p>}
    </div>
  );
}
