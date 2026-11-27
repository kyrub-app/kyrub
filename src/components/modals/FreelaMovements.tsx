import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Role='requester'|'freelancer';
const labels:Record<string,string>={not_due:'Pagamento previsto para a conclusão',awaiting_payment:'Aguardando pagamento',awaiting_receipt:'Pagamento informado; recebimento pendente',nonreceipt_reported:'Não recebimento informado',disputed:'Divergência financeira',receipt_reported:'Recebimento informado; pagamento não declarado',bilaterally_reported_received:'Recebimento confirmado pelas partes',administratively_closed_unverified:'Análise encerrada; recebimento não verificado'};
type Adjustment={direction:'additional'|'refund';flow:'inflow'|'outflow';amountMinor:number;financialState:string;restrictionActive:boolean;reviewStatus:string|null;lastStatementAt:string|null;bankVerified:false};
type Cancellation={state:'resolved'|'pending';recognizedServiceMinor:number|null;reportedReceivedMinor:number|null;restrictionActive:boolean;reviewStatus:string|null;adjustment:Adjustment|null};
type Entry={operationalStatus:string;requesterStoreId:string|null;cancellation:Cancellation|null;offerId:string;title:string;amountMinor:number;serviceCompleted:boolean;timing:'advance'|'on_completion';financialState:string;restrictionActive:boolean;reviewStatus:string|null;lastStatementAt:string|null;bankVerified:false};
type Page={role:Role;currency:'BRL';entries:Entry[];nextCursor:string|null;otherMethods:number;operationalReview:number;hourlyPending:number;bankVerifiedMinor:null};
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=20;
const amount=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=999999999;
const validCancellation=(e:Entry,role:Role)=>{
 const c=e.cancellation;if(e.operationalStatus!=='cancelled')return c===null;
 if(!c||!['pending','resolved'].includes(c.state)||typeof c.restrictionActive!=='boolean'||![null,'open','review_requested','resolved_voluntarily','resolved_administratively'].includes(c.reviewStatus))return false;
 if(c.state==='pending')return c.recognizedServiceMinor===null&&c.reportedReceivedMinor===null&&c.adjustment===null;
 if(!amount(c.recognizedServiceMinor)||!amount(c.reportedReceivedMinor)||c.recognizedServiceMinor>e.amountMinor||c.reportedReceivedMinor>e.amountMinor||c.restrictionActive)return false;
 const delta=c.recognizedServiceMinor-c.reportedReceivedMinor,a=c.adjustment;
 if(delta===0)return a===null;
 return !!a&&a.direction===(delta>0?'additional':'refund')&&a.flow===((delta>0)===(role==='requester')?'outflow':'inflow')&&a.amountMinor===Math.abs(delta)&&Object.hasOwn(labels,a.financialState)&&typeof a.restrictionActive==='boolean'&&[null,'pending','resolved_voluntarily','resolved_administratively'].includes(a.reviewStatus)&&(a.lastStatementAt===null||typeof a.lastStatementAt==='string'&&Number.isFinite(Date.parse(a.lastStatementAt)))&&a.bankVerified===false;
};
const valid=(v:unknown,role:Role):v is Page=>{
 if(!v||typeof v!=='object')return false;
 const p=v as Page;
 return p.role===role&&p.currency==='BRL'&&p.bankVerifiedMinor===null&&count(p.otherMethods)&&count(p.operationalReview)&&count(p.hourlyPending)&&(p.nextCursor===null||validId(p.nextCursor))&&
 Array.isArray(p.entries)&&p.entries.length+p.otherMethods+p.operationalReview+p.hourlyPending<=20&&p.entries.every(e=>e&&validId(e.offerId)&&typeof e.title==='string'&&e.title.length<=120&&['contracted','in_progress','completion_requested','completed','under_review','cancelled'].includes(e.operationalStatus)&&e.serviceCompleted===(e.operationalStatus==='completed')&&(e.requesterStoreId===null||validId(e.requesterStoreId))&&validCancellation(e,role)&&
 Number.isSafeInteger(e.amountMinor)&&e.amountMinor>0&&e.amountMinor<=999999999&&typeof e.serviceCompleted==='boolean'&&['advance','on_completion'].includes(e.timing)&&
 Object.hasOwn(labels,e.financialState)&&typeof e.restrictionActive==='boolean'&&(e.reviewStatus===null||['pending','resolved_voluntarily','resolved_administratively'].includes(e.reviewStatus))&&
 (e.lastStatementAt===null||typeof e.lastStatementAt==='string'&&Number.isFinite(Date.parse(e.lastStatementAt)))&&e.bankVerified===false);
};
const money=(v:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const button='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50';
export default function FreelaMovements(){
 const [user,setUser]=useState<User|null>(null),[role,setRole]=useState<Role>('freelancer'),[page,setPage]=useState<Page|null>(null),[cursor,setCursor]=useState<string|undefined>(undefined);
 const [refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 useEffect(()=>onAuthStateChanged(auth,u=>{generation.current++;setUser(u);setRole('freelancer');setCursor(undefined);setPage(null);setError('');setBusy(false);}),[]);
 useEffect(()=>{
  if(!user||auth.currentUser?.uid!==user.uid)return;
  const id=++generation.current,abort=new AbortController(),active=()=>generation.current===id&&!abort.signal.aborted&&auth.currentUser?.uid===user.uid;
  setPage(null);setBusy(true);setError('');
  void(async()=>{
   const token=await user.getIdToken();if(!active())return;
   const res=await fetch('/api/freelance/finance?view=movements&role='+role+(cursor?'&cursor='+encodeURIComponent(cursor):''),{cache:'no-store',signal:abort.signal,headers:{authorization:'Bearer '+token}});
   const data=await res.json().catch(()=>null);if(!active())return;
   if(!res.ok||!valid(data,role))throw Error();
   setPage(data);
  })().catch(()=>{if(active())setError('Não foi possível confirmar suas movimentações de Freelas.');}).finally(()=>{if(active())setBusy(false);});
  return()=>{generation.current++;abort.abort();};
 },[user,role,cursor,refresh]);
 const current=user&&auth.currentUser?.uid===user.uid&&page?.role===role?page:null;
 const sum=(states:string[])=>current?.entries.filter(e=>!['cancelled','under_review'].includes(e.operationalStatus)&&states.includes(e.financialState)).reduce((s,e)=>s+e.amountMinor,0)??0;
 const adjustmentSum=(flow:'inflow'|'outflow',confirmed:boolean)=>current?.entries.reduce((total,e)=>{const a=e.cancellation?.adjustment;return total+(a&&a.flow===flow&&(a.financialState==='bilaterally_reported_received')===confirmed?a.amountMinor:0);},0)??0;
 const select=(r:Role)=>{setPage(null);setCursor(undefined);setRole(r);};
 return <section id="freela-movements" className="rounded-2xl border border-slate-800 bg-slate-950 p-3 space-y-3 text-sm text-slate-300">
  <h4 className="text-base font-bold text-white">Movimentações de Freelas</h4>
  <p>Homologação local · Pix externo, sem custódia do Kyrub. Não representa saldo disponível.</p>
  <div className="flex flex-wrap gap-2"><button type="button" className={button} aria-pressed={role==='freelancer'} disabled={busy} onClick={()=>select('freelancer')}>Como contratado</button><button type="button" className={button} aria-pressed={role==='requester'} disabled={busy} onClick={()=>select('requester')}>Como contratante</button><button type="button" className={button} disabled={busy||!user} onClick={()=>setRefresh(n=>n+1)}>Atualizar movimentações de Freelas</button></div>
  {busy&&<p role="status">Consultando movimentações…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}
  {current&&<>
   <p className="text-xs">Resumo dos contratos sem cancelamento ou revisão operacional nesta página · {role==='freelancer'?'Entradas':'Saídas'} contratuais</p>
   <div className="grid grid-cols-2 gap-2">{[
    ['Previstos ou aguardando pagamento',money(sum(['not_due','awaiting_payment']))],
    ['Pagamento informado',money(sum(['awaiting_receipt']))],
    ['Recebimento informado',money(sum(['receipt_reported']))],
    ['Recebimento confirmado pelas partes',money(sum(['bilaterally_reported_received']))],
    ['Em divergência ou não recebido',money(sum(['disputed','nonreceipt_reported']))],
    ['Encerrado sem confirmação de recebimento',money(sum(['administratively_closed_unverified']))],
    ['Liquidação bancária','Não verificada']
   ].map(([label,value])=><div key={label} className="rounded-xl border border-slate-800 p-2"><p>{label}</p><strong className="block text-white break-words">{value}</strong></div>)}</div>
   <h5 className="font-bold text-white">Ajustes de cancelamento nesta página</h5>
   <div className="grid grid-cols-2 gap-2">{[['Entradas com confirmação bilateral',money(adjustmentSum('inflow',true))],['Saídas com confirmação bilateral',money(adjustmentSum('outflow',true))],['Entradas sem confirmação bilateral',money(adjustmentSum('inflow',false))],['Saídas sem confirmação bilateral',money(adjustmentSum('outflow',false))]].map(([label,value])=><div key={label} className="rounded-xl border border-slate-800 p-2"><p>{label}</p><strong className="block text-white break-words">{value}</strong></div>)}</div>
   {current.entries.map(e=><article key={e.offerId} className="rounded-xl border border-slate-800 p-3 space-y-1"><h5 className="font-bold text-white break-words">{e.title}</h5><p>Valor originalmente contratado: {money(e.amountMinor)} · {e.timing==='advance'?'Antecipado':'Na conclusão'}</p>{e.requesterStoreId&&<p>Contratação empresarial</p>}<p>{e.operationalStatus==='cancelled'?'Serviço cancelado · histórico original':e.operationalStatus==='under_review'?'Serviço em revisão operacional · fora do resumo':e.serviceCompleted?'Serviço concluído':'Serviço ainda não concluído'}</p><p>{labels[e.financialState]}</p>{e.restrictionActive&&<p className="text-amber-300">Restrição deste contrato ativa</p>}{e.reviewStatus==='pending'&&<p>Análise administrativa solicitada</p>}{e.cancellation&&<div className="border-t border-slate-800 pt-2 space-y-1"><p className="font-bold">Apuração do cancelamento</p>{e.cancellation.state==='pending'?<p>Sem apuração definitiva.</p>:<><p>Serviço reconhecido: {money(e.cancellation.recognizedServiceMinor!)}</p><p>Recebimento reconhecido: {money(e.cancellation.reportedReceivedMinor!)}</p>{e.cancellation.adjustment?<div><p>{e.cancellation.adjustment.direction==='refund'?'Devolução':'Complemento'} · {e.cancellation.adjustment.flow==='inflow'?'Entrada':'Saída'}: {money(e.cancellation.adjustment.amountMinor)}</p><p>{labels[e.cancellation.adjustment.financialState]}</p>{e.cancellation.adjustment.restrictionActive&&<p className="text-amber-300">Restrição da regularização ativa</p>}{e.cancellation.adjustment.reviewStatus==='pending'&&<p>Regularização em análise administrativa</p>}</div>:<p>Sem saldo complementar.</p>}</>}{e.cancellation.restrictionActive&&<p className="text-amber-300">Restrição da apuração ativa</p>}{e.cancellation.reviewStatus==='review_requested'&&<p>Apuração em análise administrativa</p>}</div>}</article>)}
   {!current.entries.length&&<p>Nenhum contrato Pix externo nesta página.</p>}
   {!!current.otherMethods&&<p>{current.otherMethods} contrato(s) de outras modalidades não incluídos.</p>}
   {!!current.operationalReview&&<p>{current.operationalReview} contrato(s) cancelado(s) ou em revisão operacional, fora deste resumo financeiro.</p>}
   {!!current.hourlyPending&&<p>{current.hourlyPending} contrato(s) por jornada ainda não incluídos nesta visão. Seus valores estimados não integram os totais.</p>}
   <p>Os totais são separados por contrato original e ajuste nesta página. Não some as duas categorias como saldo disponível. Não equivalem a extrato ou recebimento bancário.</p>
   {current.nextCursor&&<button type="button" className={button} disabled={busy} onClick={()=>{setPage(null);setCursor(current.nextCursor!);}}>Próxima página de movimentações</button>}
   {cursor&&<button type="button" className={button} disabled={busy} onClick={()=>{setPage(null);setCursor(undefined);}}>Primeira página</button>}
  </>}
 </section>;
}
