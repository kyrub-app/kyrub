import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Role='worker'|'requester';
type Proposal={id:string;recognizedServiceMinor:number;proposedBy:Role;status:'pending'|'accepted'|'declined'|'withdrawn'};
type View={offerId:string;role:Role;sourceDigest:string;estimatedMinor:number;capMinor:number;referenceMinor:number|null;recordedMs:number|null;excessMs:number|null;proposal:Proposal|null;agreedMinor:number|null;payable:false;bankVerified:false};
const money=(minor:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(minor/100);
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const labels={pending:'Aguardando resposta',accepted:'Valor acordado',declined:'Recusada',withdrawn:'Retirada'};
const actions:Record<string,string>={propose_hourly_cancellation:'Propor valor',accept_hourly_cancellation:'Aceitar valor',decline_hourly_cancellation:'Recusar proposta',withdraw_hourly_cancellation:'Retirar proposta'};
function cents(s:string){const m=/^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(s.trim());return m?Number(m[1])*100+Number((m[2]??'').padEnd(2,'0')):null;}
export default function FreelaHourlyCancellationAgreement({user,offerId}:{user:User;offerId:string}){
 const [view,setView]=useState<View|null>(null),[amount,setAmount]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [pending,setPending]=useState<{action:string;id:string;digest:string;amount?:number}|null>(null);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function load(action?:NonNullable<typeof pending>){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const headers={authorization:'Bearer '+token,'content-type':'application/json'},url='/api/freelance/finance';
   if(action){
    const r=await fetch(url,{method:'POST',headers,signal:ctl.signal,cache:'no-store',body:JSON.stringify({action:action.action,offerId,confirmed:true,proposalId:action.id,sourceDigest:action.digest,...(action.amount!==undefined?{recognizedServiceMinor:action.amount}:{})})});
    const ack=await r.json();if(!live())return;if(!r.ok||ack?.confirmed!==true)throw Error(ack?.code==='REAUTHENTICATION_REQUIRED'?'Entre novamente para confirmar.':'Operação não confirmada. Consulte novamente.');
    setPending(null);setAmount('');
   }
   const r=await fetch(url+'?view=hourly_cancellation_agreement&offerId='+encodeURIComponent(offerId),{headers,signal:ctl.signal,cache:'no-store'});const v=await r.json();if(!live())return;
   if(!r.ok||v?.offerId!==offerId||!['worker','requester'].includes(v.role)||typeof v.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.sourceDigest)||!Number.isSafeInteger(v.capMinor)||v.capMinor<0||v.payable!==false||v.bankVerified!==false||!(v.proposal===null||v.proposal&&typeof v.proposal.id==='string'&&Object.hasOwn(labels,v.proposal.status)&&['worker','requester'].includes(v.proposal.proposedBy)&&Number.isSafeInteger(v.proposal.recognizedServiceMinor)&&v.proposal.recognizedServiceMinor>=0&&v.proposal.recognizedServiceMinor<=v.capMinor))throw Error('Acordo indisponível.');
   setView(v);setPending(null);
  }catch(e){if(live()){setView(null);setPending(null);setError(e instanceof Error?e.message:'Acordo indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 const p=view?.proposal,minor=cents(amount);
 function ask(action:string){if(!view)return;if(action==='propose_hourly_cancellation'){if(minor===null||minor>view.capMinor)return;setPending({action,id:crypto.randomUUID(),digest:view.sourceDigest,amount:minor});}else if(p)setPending({action,id:p.id,digest:view.sourceDigest});}
 return <section className="space-y-2 rounded-xl border border-slate-700 p-3"><h4 className="font-bold">Acordo financeiro do cancelamento</h4>
  <p>Valor consensual pelo serviço. Não confirma pagamento, não gera Pix e não decide indenizações.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void load()}>Consultar apuração</button>
  {error&&<p role="alert">{error}</p>}
  {view&&<><p>Referência registrada: {view.referenceMinor===null?'Indefinida':money(view.referenceMinor)} · Limite do acordo: {money(view.capMinor)}</p>
   {p&&<p>{labels[p.status]}: {money(p.recognizedServiceMinor)}</p>}
   {p?.status==='accepted'&&<p>Valor reconhecido pelas partes. Regularização do pagamento ainda indisponível nesta etapa.</p>}
   {(!p||['declined','withdrawn'].includes(p.status))&&<><label className="block">Valor reconhecido (R$)<input value={amount} onChange={e=>setAmount(e.target.value)} disabled={busy||!!pending} inputMode="decimal" className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2"/></label><button type="button" className={btn} disabled={busy||!!pending||minor===null||minor>view.capMinor} onClick={()=>ask('propose_hourly_cancellation')}>Propor valor</button></>}
   {p?.status==='pending'&&(p.proposedBy===view.role?<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('withdraw_hourly_cancellation')}>Retirar proposta</button>:<div className="flex gap-2"><button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('accept_hourly_cancellation')}>Aceitar valor</button><button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('decline_hourly_cancellation')}>Recusar proposta</button></div>)}
  </>}
  {pending&&<div><p>Confirma: {actions[pending.action]} — {money(pending.amount??p?.recognizedServiceMinor??0)}?</p><button type="button" className={btn} disabled={busy} onClick={()=>void load(pending)}>Confirmar</button><button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
 </section>;
}
