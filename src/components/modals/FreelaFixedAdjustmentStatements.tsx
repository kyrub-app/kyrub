import FreelaHourlyReviewNotes from './FreelaHourlyReviewNotes';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Statement='paid'|'received'|'not_received';
type View={offerId:string;sourceDigest:string;amountMinor:number;direction:'additional'|'refund';role:'payer'|'recipient';state:string;hadDisagreement:boolean;restrictionActive:boolean;reviewStatus:'pending'|'resolved_voluntarily'|'resolved_administratively'|null;decision:null|{outcome:string;reason:string;decidedAt:string};statements:{role:'payer'|'recipient';statement:Statement;recordedAt:string}[];bankVerified:false};
const states:Record<string,string>={awaiting_payment:'Aguardando pagamento',awaiting_receipt:'Aguardando confirmação',nonreceipt_reported:'Não recebimento informado',disputed:'Divergência financeira',receipt_reported:'Recebimento informado',bilaterally_reported_received:'Recebimento informado pelas duas partes'};
const labels:Record<Statement,string>={paid:'Informar pagamento',received:'Confirmar recebimento',not_received:'Informar não recebimento'};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
export default function FreelaFixedAdjustmentStatements({user,offerId,sourceDigest,amountMinor,direction,onRefresh}:{user:User;offerId:string;sourceDigest:string;amountMinor:number;direction:'additional'|'refund';onRefresh:()=>void}){
 const [v,setV]=useState<View|null>(null),[pending,setPending]=useState<{statement?:Statement;id?:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function run(send=false){
  if(active.current||auth.currentUser?.uid!==user.uid||send&&!pending)return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  // Hide any previously displayed raw Pix key before every new consultation or statement.
  onRefresh();
  try{
   const token=await user.getIdToken();if(!live())return;
   const url='/api/freelance/finance',headers={authorization:'Bearer '+token,'content-type':'application/json'};
   if(send&&pending){
    const r=await fetch(url,{method:'POST',headers,cache:'no-store',signal:ctl.signal,body:JSON.stringify({offerId,action:pending.statement?'statement_adjustment':'request_adjustment_review',sourceDigest,expectedAmountMinor:amountMinor,confirmed:true,...(pending.statement?{statement:pending.statement,eventId:pending.id}:{})})}),a=await r.json();if(!live())return;
    if(!r.ok||a?.confirmed!==true)throw Error(a?.code==='REAUTHENTICATION_REQUIRED'?'Entre novamente para confirmar.':'Manifestação não confirmada. Consulte novamente.');
    setPending(null);
   }
   const r=await fetch(url+'?view=fixed_adjustment_statements&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:ctl.signal}),a=await r.json();if(!live())return;
   if(!r.ok||a?.offerId!==offerId||a.sourceDigest!==sourceDigest||a.amountMinor!==amountMinor||a.direction!==direction||a.bankVerified!==false||!['payer','recipient'].includes(a.role)||!Object.hasOwn(states,a.state)||typeof a.hadDisagreement!=='boolean'||a.restrictionActive!==(a.state==='disputed'&&a.reviewStatus!=='resolved_administratively')||![null,'pending','resolved_voluntarily','resolved_administratively'].includes(a.reviewStatus)||!(a.reviewStatus==='resolved_administratively'?a.decision&&['payment_evidence_accepted','nonreceipt_evidence_accepted','inconclusive'].includes(a.decision.outcome)&&typeof a.decision.reason==='string'&&typeof a.decision.decidedAt==='string':a.decision===null)||!Array.isArray(a.statements)||a.statements.length>3||!a.statements.every((s:View['statements'][number])=>s&&['payer','recipient'].includes(s.role)&&Object.hasOwn(labels,s.statement)&&typeof s.recordedAt==='string'))throw Error('Consulta da regularização indisponível.');
   setV(a);setPending(null);
  }catch(e){if(live()){setV(null);setPending(null);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 const paid=v?.statements.some(s=>s.statement==='paid'),received=v?.statements.some(s=>s.statement==='received'),denied=v?.statements.some(s=>s.statement==='not_received');
 const ask=(statement:Statement)=>{onRefresh();setPending({statement,id:crypto.randomUUID()});};
 return <section aria-label="Declarações da regularização" className="space-y-2 rounded-xl border border-slate-700 p-3"><h6 className="font-bold">Declarações da regularização</h6><p>Registre somente fatos já ocorridos. A Kyrub não confirma transferências bancárias.</p><button type="button" className={btn} disabled={busy||!!pending} onClick={()=>void run()}>Consultar situação da regularização</button>{error&&<p role="alert">{error}</p>}
 {v&&<><p>{states[v.state]}</p>{v.restrictionActive&&<p className="text-amber-300">Novas contratações restritas para ambas as partes até a resolução desta divergência.</p>}{v.reviewStatus==='pending'&&<p>Análise administrativa solicitada.</p>}{v.reviewStatus==='resolved_voluntarily'&&<p>Divergência desta obrigação regularizada voluntariamente. Outras restrições podem permanecer.</p>}{v.statements.map((s,i)=><p key={i}>{s.role==='payer'?'Pagador':'Destinatário'}: {labels[s.statement]} · {new Date(s.recordedAt).toLocaleString('pt-BR')}</p>)}
 {v.reviewStatus&&<FreelaHourlyReviewNotes key={'adjustment:'+user.uid+':'+offerId+':'+sourceDigest} user={user} offerId={offerId} kind="fixed_adjustment" sourceDigest={sourceDigest}/>}{v.decision&&<div><p>Decisão administrativa: {v.decision.outcome==='payment_evidence_accepted'?'Evidências de pagamento acolhidas':v.decision.outcome==='nonreceipt_evidence_accepted'?'Evidências de não recebimento acolhidas':'Inconclusiva'}</p><p className="break-words">{v.decision.reason}</p><p>Restrição deste caso retirada. Não representa quitação bancária nem extinção da obrigação.</p></div>}{!v.decision&&v.role==='payer'&&!paid&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('paid')}>Informar pagamento efetuado</button>}{!v.decision&&v.role==='recipient'&&!received&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('received')}>Confirmar recebimento</button>}{!v.decision&&v.role==='recipient'&&!received&&!denied&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('not_received')}>Informar não recebimento</button>}{v.restrictionActive&&!v.reviewStatus&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>{onRefresh();setPending({});}}>Solicitar análise administrativa</button>}</>}
 {pending&&<div><p>Confirma {pending.statement?labels[pending.statement].toLowerCase():'a solicitação de análise'} referente a esta obrigação de {new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(amountMinor/100)}? Nenhuma transferência será executada.</p><button type="button" className={btn} disabled={busy} onClick={()=>void run(true)}>Confirmar declaração</button>{' '}<button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
 </section>;
}
