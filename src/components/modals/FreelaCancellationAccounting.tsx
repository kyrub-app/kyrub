import FreelaFixedAdjustmentPix from './FreelaFixedAdjustmentPix';
import FreelaHourlyReviewNotes from './FreelaHourlyReviewNotes';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Amounts={currency:'BRL';agreedMinor:number;recognizedServiceMinor:number;reportedReceivedMinor:number;proposedAdditionalMinor:number;proposedRefundMinor:number;bankVerified:false;settlement:'not_verified';responsibility:'not_determined'};
type Proposal={id:string;status:'pending'|'accepted'|'closed'|'stale';proposedByMe:boolean;proposedAt:string;closure:'withdrawn'|'declined'|null;amounts:Amounts|null};
type Resolution=Amounts&{sourceDigest:string;direction:'additional'|'refund'|'none';amountMinor:number;resolvedAt:string};
type View={resolution:Resolution|null;offerId:string;currency:'BRL';agreedMinor:number;priorPaymentState:string;eligible:boolean;snapshot:string;restrictionActive:boolean;evidenceSource:string|null;dispute:null|{status:'open'|'review_requested'|'resolved_voluntarily'|'resolved_administratively';requestedAt:string|null;decision?:{reason:string;decidedAt:string;amounts:Amounts}};bankVerified:false;settlement:'not_verified';proposal:Proposal|null};
type Action={action:'propose_cancellation_accounting'|'accept_cancellation_accounting'|'close_cancellation_accounting'|'dispute_fixed_cancellation'|'request_fixed_cancellation_review';proposalId?:string;snapshot?:string;recognizedServiceMinor?:number;reportedReceivedMinor?:number;confirmed:true};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const field='w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-white';
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const errors:Record<string,string>={FREELANCE_CANCELLATION_ACCOUNTING_CONFLICT:'A proposta ou o histórico mudou, ou os valores são incompatíveis. Atualize a consulta.',REAUTHENTICATION_REQUIRED:'Entre novamente na sua conta para confirmar.',FREELANCE_FORBIDDEN:'Operação não autorizada.',AUTH_REQUIRED:'Entre novamente para continuar.'};
function cents(s:string):number|null{
 const m=/^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(s.trim());if(!m)return null;
 return Number(m[1])*100+Number((m[2]??'').padEnd(2,'0'));
}
function valid(v:unknown,id:string):v is View{
 if(!v||typeof v!=='object')return false;const d=v as View;
 if(d.offerId!==id||d.currency!=='BRL'||d.bankVerified!==false||d.settlement!=='not_verified'||!Number.isSafeInteger(d.agreedMinor)||d.agreedMinor<1||d.agreedMinor>999999999||typeof d.eligible!=='boolean'||typeof d.restrictionActive!=='boolean'||! /^[a-f0-9]{64}$/.test(d.snapshot)||!(d.dispute===null||d.dispute&&['open','review_requested','resolved_voluntarily','resolved_administratively'].includes(d.dispute.status))||!['awaiting_payment','awaiting_receipt','nonreceipt_reported','disputed','receipt_reported','bilaterally_reported_received'].includes(d.priorPaymentState))return false;
 if(d.resolution!==null){const r=d.resolution;if(!r||r.bankVerified!==false||r.settlement!=='not_verified'||r.agreedMinor!==d.agreedMinor||typeof r.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(r.sourceDigest)||![r.recognizedServiceMinor,r.reportedReceivedMinor,r.proposedAdditionalMinor,r.proposedRefundMinor,r.amountMinor].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=d.agreedMinor)||r.proposedAdditionalMinor!==Math.max(0,r.recognizedServiceMinor-r.reportedReceivedMinor)||r.proposedRefundMinor!==Math.max(0,r.reportedReceivedMinor-r.recognizedServiceMinor)||r.amountMinor!==r.proposedAdditionalMinor+r.proposedRefundMinor||r.direction!==(r.proposedAdditionalMinor>0?'additional':r.proposedRefundMinor>0?'refund':'none')||d.restrictionActive)return false;}
 if(d.proposal===null)return true;
 const p=d.proposal;if(!p||typeof p.id!=='string'||!p.id||typeof p.proposedByMe!=='boolean'||!Number.isFinite(Date.parse(p.proposedAt))||!['pending','accepted','closed','stale'].includes(p.status)||![null,'withdrawn','declined'].includes(p.closure))return false;
 if(!d.eligible||p.status==='closed'||p.status==='stale')return p.amounts===null;
 const a=p.amounts;
 return !!a&&a.currency==='BRL'&&a.agreedMinor===d.agreedMinor&&a.bankVerified===false&&a.settlement==='not_verified'&&a.responsibility==='not_determined'&&[a.recognizedServiceMinor,a.reportedReceivedMinor,a.proposedAdditionalMinor,a.proposedRefundMinor].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=d.agreedMinor)&&a.proposedAdditionalMinor===Math.max(0,a.recognizedServiceMinor-a.reportedReceivedMinor)&&a.proposedRefundMinor===Math.max(0,a.reportedReceivedMinor-a.recognizedServiceMinor);
}
export default function FreelaCancellationAccounting({user,offerId}:{user:User;offerId:string}){
 const [data,setData]=useState<View|null>(null),[earned,setEarned]=useState(''),[received,setReceived]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [pending,setPending]=useState<{label:string;body:Action}|null>(null);
 const lock=useRef(false),request=useRef<AbortController|null>(null),generation=useRef(0);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 const run=async(body?:Action)=>{
  if(lock.current||auth.currentUser?.uid!==user.uid)return;
  lock.current=true;const id=++generation.current,abort=new AbortController();request.current=abort;
  const active=()=>id===generation.current&&!abort.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');setData(null);if(!body){setPending(null);setEarned('');setReceived('');}
  try{
   const token=await user.getIdToken();if(!active())return;const headers={authorization:'Bearer '+token};
   if(body){
    const r=await fetch('/api/freelance/finance',{method:'POST',headers:{...headers,'content-type':'application/json'},cache:'no-store',signal:abort.signal,body:JSON.stringify({offerId,...body})});
    const p=await r.json().catch(()=>null);if(!active())return;
    if(!r.ok||p?.confirmed!==true){if(r.status===409)setPending(null);throw Error(errors[p?.code]??'Operação não confirmada.');}
    setPending(null);setEarned('');setReceived('');setMessage('Operação de apuração registrada pelo servidor.');
   }
   const r=await fetch('/api/freelance/finance?view=cancellation_accounting&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:abort.signal});
   const p=await r.json().catch(()=>null);if(!active())return;
   if(!r.ok||!valid(p,offerId))throw Error(errors[p?.code]??'Consulta de apuração não confirmada.');
   setData(p);
  }catch(e){if(active())setError(e instanceof Error?e.message:'Apuração indisponível.');}
  finally{if(active()){lock.current=false;setBusy(false);}}
 };
 const a=cents(earned),b=cents(received),p=data?.proposal;
 const canPropose=!!data?.eligible&&!data.resolution&&!['resolved_voluntarily','resolved_administratively'].includes(data.dispute?.status??'')&&(!p||p.status==='closed'||p.status==='stale');
 const validInput=!!data&&a!==null&&b!==null&&a<=data.agreedMinor&&b<=data.agreedMinor&&(data.priorPaymentState!=='bilaterally_reported_received'||b===data.agreedMinor)&&(data.priorPaymentState!=='nonreceipt_reported'||b===0);
 const ask=(label:string,body:Action)=>setPending({label,body});
 if(auth.currentUser?.uid!==user.uid)return null;
 return <section aria-label="Apuração do cancelamento" className="rounded-xl border border-slate-700 p-3 space-y-3 text-sm">
  <h5 className="font-bold text-white">Apuração do cancelamento</h5>
  <p>Somente dados fictícios. Propostas não são cobranças, estornos, saldo exigível ou confirmação bancária.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void run()}>Consultar apuração</button>
  {busy&&<p role="status">Consultando apuração…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status">{message}</p>}
  {data&&<><p>Valor original: {money(data.agreedMinor)}</p>
   {data.resolution&&<div className="space-y-1 rounded-xl border border-slate-700 p-3"><h6 className="font-bold">Apuração definitiva</h6><p>Remuneração reconhecida: {money(data.resolution.recognizedServiceMinor)}</p><p>Recebimento reconhecido: {money(data.resolution.reportedReceivedMinor)}</p><p>{data.resolution.direction==='none'?'Nenhum saldo complementar.':(data.resolution.direction==='additional'?'Complemento do contratante ao profissional: ':'Devolução do profissional ao contratante: ')+money(data.resolution.amountMinor)}</p><p>{data.resolution.direction==='none'?'Nenhuma nova transferência necessária.':'Obrigação registrada. Declarações específicas ainda em homologação.'} Não representa confirmação bancária.</p></div>}
   {data.resolution&&data.resolution.direction!=='none'&&<FreelaFixedAdjustmentPix key={user.uid+':'+offerId+':'+data.resolution.sourceDigest} user={user} offerId={offerId} sourceDigest={data.resolution.sourceDigest} amountMinor={data.resolution.amountMinor} direction={data.resolution.direction}/>}
   {data.restrictionActive&&<p className="text-amber-300">Novas contratações restritas para ambas as partes. A regularização voluntária permanece disponível.</p>}
   {data.dispute?.status==='review_requested'&&<p>Análise administrativa solicitada. </p>}
   {data.dispute?.requestedAt&&data.evidenceSource&&<FreelaHourlyReviewNotes key={user.uid+':'+offerId+':'+data.evidenceSource} user={user} offerId={offerId} kind="fixed_cancellation" sourceDigest={data.evidenceSource}/>}
   {data.dispute?.status==='resolved_administratively'&&data.dispute.decision&&<div><p>Decisão administrativa</p><p className="break-words">{data.dispute.decision.reason}</p><p>Remuneração reconhecida: {money(data.dispute.decision.amounts.recognizedServiceMinor)}</p><p>Recebido reconhecido: {money(data.dispute.decision.amounts.reportedReceivedMinor)}</p><p>Complemento: {money(data.dispute.decision.amounts.proposedAdditionalMinor)} · Devolução: {money(data.dispute.decision.amounts.proposedRefundMinor)}</p><p>Nenhuma transferência confirmada.</p></div>}
   {data.dispute?.status==='resolved_voluntarily'&&<p>Divergência de apuração encerrada por acordo. Outras restrições podem permanecer.</p>}
   {data.eligible&&!data.dispute&&p?.status==='closed'&&p.closure==='declined'&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('Declarar divergência financeira',{action:'dispute_fixed_cancellation',snapshot:data.snapshot,confirmed:true})}>Declarar divergência financeira</button>}
   {data.eligible&&data.dispute?.status==='open'&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('Solicitar análise administrativa',{action:'request_fixed_cancellation_review',snapshot:data.snapshot,confirmed:true})}>Solicitar análise administrativa</button>}
   {!data.eligible&&<p className="text-amber-300">Regularize primeiro as manifestações ou divergências do pagamento original.</p>}
   {p&&<><p>{p.status==='accepted'?'Proposta aceita pelas partes':p.status==='pending'?'Proposta aguardando aceite':p.status==='closed'?'Proposta encerrada sem aceite':'Proposta desatualizada pelo histórico financeiro'}</p>
    {p.amounts&&<div className="space-y-1"><p>Remuneração reconhecida: {money(p.amounts.recognizedServiceMinor)}</p><p>Valor declarado como recebido: {money(p.amounts.reportedReceivedMinor)}</p><p>Complemento proposto: {money(p.amounts.proposedAdditionalMinor)}</p><p>Devolução proposta: {money(p.amounts.proposedRefundMinor)}</p></div>}
    {data.dispute?.status!=='resolved_administratively'&&p.status==='pending'&&data.eligible&&p.amounts&&!p.proposedByMe&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('Aceitar os valores da apuração',{action:'accept_cancellation_accounting',proposalId:p.id,confirmed:true})}>Aceitar proposta de apuração</button>}
    {p.status==='pending'&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask(p.proposedByMe?'Retirar proposta':'Recusar proposta',{action:'close_cancellation_accounting',proposalId:p.id,confirmed:true})}>{p.proposedByMe?'Retirar proposta':'Recusar proposta'}</button>}
   </>}
   {canPropose&&<div className="space-y-2">
    <label className="block">Remuneração reconhecida (R$)<input className={field} inputMode="decimal" maxLength={10} value={earned} disabled={busy||!!pending} onChange={e=>setEarned(e.target.value)}/></label>
    <label className="block">Valor declarado como recebido (R$)<input className={field} inputMode="decimal" maxLength={10} value={received} disabled={busy||!!pending} onChange={e=>setReceived(e.target.value)}/></label>
    <p>Informe zero expressamente quando aplicável. Não deixe o valor em branco.</p>
    {validInput&&a!==null&&b!==null&&<p>Complemento proposto: {money(Math.max(0,a-b))} · Devolução proposta: {money(Math.max(0,b-a))}</p>}
    <button type="button" className={btn} disabled={busy||!!pending||!validInput} onClick={()=>{if(validInput&&a!==null&&b!==null)ask('Enviar proposta de apuração',{action:'propose_cancellation_accounting',proposalId:crypto.randomUUID(),recognizedServiceMinor:a,reportedReceivedMinor:b,confirmed:true});}}>Propor apuração</button>
   </div>}
  </>}
  {pending&&<div className="rounded-xl border border-teal-700 p-3 space-y-2"><p>Confirma: {pending.label}?</p><p>O registro não efetua pagamento nem devolução.</p>{pending.body.action==='dispute_fixed_cancellation'&&<p>Esta declaração restringe novas contratações de ambas as partes, sem atribuir culpa.</p>}<button type="button" className={btn} disabled={busy} onClick={()=>void run(pending.body)}>Confirmar apuração</button>{' '}<button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
 </section>;
}
