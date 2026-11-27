import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Role='worker'|'requester';
type Proposal={id:string;recognizedExcessMs:number;proposedBy:Role;status:'pending'|'accepted'|'declined'|'withdrawn'};
type View={offerId:string;role:Role;sourceDigest:string;hourlyRateMinor:number;authorizedMinor:number;excessMs:number;recordedMs:number;proposal:Proposal|null;resolved:null|{recognizedExcessMs:number;recognizedServiceMinor:number};dispute:null|{status:'open'|'review_requested'|'resolved_voluntarily'|'resolved_administratively';decision?:{recognizedExcessMs:number;reason:string;decidedAt:string}};restrictionActive:boolean;payable:boolean;bankVerified:false};
const valid=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const duration=(ms:number)=>Math.floor(ms/60000)+' min '+((ms%60000)/1000).toLocaleString('pt-BR',{maximumFractionDigits:3})+' s';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const labels={pending:'Aguardando resposta',accepted:'Aceita',declined:'Recusada',withdrawn:'Retirada'};
const actions:Record<string,string>={propose_hourly_excess:'Propor reconhecimento',accept_hourly_excess:'Aceitar reconhecimento',decline_hourly_excess:'Recusar proposta',withdraw_hourly_excess:'Retirar proposta',dispute_hourly_excess:'Declarar divergência',request_hourly_excess_review:'Solicitar análise administrativa'};
type Action={action:string;proposalId?:string;sourceDigest:string;recognizedExcessMs?:number};
export default function FreelaHourlyExcessReview({user,offerId}:{user:User;offerId:string}){
 const [v,setV]=useState<View|null>(null),[seconds,setSeconds]=useState(''),[full,setFull]=useState(false),[pending,setPending]=useState<Action|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function load(action?:Action){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const headers={authorization:'Bearer '+token,'content-type':'application/json'},url='/api/freelance/finance';
   if(action){
    const r=await fetch(url,{method:'POST',headers,signal:ctl.signal,cache:'no-store',body:JSON.stringify({...action,offerId,confirmed:true})}),ack=await r.json();if(!live())return;
    if(!r.ok||ack?.confirmed!==true)throw Error(ack?.code==='REAUTHENTICATION_REQUIRED'?'Entre novamente para confirmar.':'Operação não confirmada. Consulte novamente.');
    setPending(null);setFull(false);setSeconds('');
   }
   const r=await fetch(url+'?view=hourly_excess_review&offerId='+encodeURIComponent(offerId),{headers,signal:ctl.signal,cache:'no-store'}),data=await r.json();if(!live())return;
   if(!r.ok||data?.offerId!==offerId||!['worker','requester'].includes(data.role)||typeof data.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.sourceDigest)||!valid(data.excessMs)||data.excessMs===0||!valid(data.recordedMs)||data.recordedMs<data.excessMs||!valid(data.hourlyRateMinor)||data.hourlyRateMinor===0||!valid(data.authorizedMinor)||typeof data.restrictionActive!=='boolean'||typeof data.payable!=='boolean'||data.payable!==(!!data.resolved&&data.resolved.recognizedServiceMinor>0)||data.bankVerified!==false||!(data.proposal===null||data.proposal&&typeof data.proposal.id==='string'&&valid(data.proposal.recognizedExcessMs)&&data.proposal.recognizedExcessMs<=data.excessMs&&['worker','requester'].includes(data.proposal.proposedBy)&&Object.hasOwn(labels,data.proposal.status))||!(data.dispute===null||data.dispute&&['open','review_requested','resolved_voluntarily','resolved_administratively'].includes(data.dispute.status))||!(data.resolved===null||data.resolved&&valid(data.resolved.recognizedServiceMinor)&&valid(data.resolved.recognizedExcessMs)&&data.resolved.recognizedExcessMs<=data.excessMs))throw Error('Revisão de excedente indisponível para este contrato.');
   setV(data);setPending(null);
  }catch(e){if(live()){setV(null);setPending(null);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 const p=v?.proposal,ms=full?v?.excessMs??null:/^\d{1,8}$/.test(seconds)?Number(seconds)*1000:null;
 function ask(action:string){
  if(!v)return;
  const base={action,sourceDigest:v.sourceDigest};
  if(action==='propose_hourly_excess'){if(ms===null||ms>v.excessMs)return;setPending({...base,proposalId:crypto.randomUUID(),recognizedExcessMs:ms});}
  else if(action==='dispute_hourly_excess'||action==='request_hourly_excess_review')setPending(base);
  else if(p)setPending({...base,proposalId:p.id});
 }
 function total(n:number){return v?Number((BigInt(v.hourlyRateMinor)*BigInt(v.recordedMs-v.excessMs+n)+1800000n)/3600000n):0;}
 return <section aria-label="Revisão de excedente" className="space-y-2 rounded-xl border border-slate-700 p-3">
  <h4 className="font-bold">Revisão de excedente da jornada</h4><p>Somente o tempo excedente registrado é negociado. A parcela autorizada permanece preservada.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void load()}>Consultar excedente</button>
  {error&&<p role="alert">{error}</p>}
  {v&&<><p>Tempo adicional registrado: {duration(v.excessMs)} · Parcela autorizada: {money(v.authorizedMinor)}</p>
   {p&&<p>Proposta {labels[p.status].toLowerCase()}: {duration(p.recognizedExcessMs)} · Total: {money(total(p.recognizedExcessMs))}</p>}
   {v.resolved&&<p>Valor reconhecido: {money(v.resolved.recognizedServiceMinor)}. {v.payable?'Atualize a consulta financeira para regularizar o Pix.':'Nenhum pagamento necessário para esta resolução.'}</p>}
   {v.restrictionActive&&<p className="text-amber-300">Novas contratações restritas para ambas as partes. Negociação voluntária disponível.</p>}
   {v.dispute?.status==='review_requested'&&<p>Análise administrativa solicitada.</p>}
   {v.dispute?.status==='resolved_voluntarily'&&<p>Divergência deste excedente resolvida. Outras restrições podem permanecer.</p>}
   {!v.dispute&&p?.status==='declined'&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('dispute_hourly_excess')}>Declarar divergência</button>}
   {v.dispute?.status==='open'&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('request_hourly_excess_review')}>Solicitar análise administrativa</button>}
   {v.dispute?.status==='resolved_administratively'&&v.dispute.decision&&<div><p>Tempo adicional reconhecido pela administração: {duration(v.dispute.decision.recognizedExcessMs)}</p><p className="break-words">{v.dispute.decision.reason}</p><p>Restrição deste caso encerrada. Outras restrições podem permanecer.</p></div>}
   {v.dispute?.status!=='resolved_administratively'&&(!p||['declined','withdrawn'].includes(p.status))&&<><label className="block">Segundos adicionais reconhecidos<input className="w-full rounded-xl bg-slate-950 border border-slate-800 p-2" inputMode="numeric" value={seconds} disabled={busy||!!pending||full} onChange={e=>setSeconds(e.target.value)}/></label>
    <label className="flex gap-2"><input type="checkbox" checked={full} disabled={busy||!!pending} onChange={e=>setFull(e.target.checked)}/>Reconhecer todo o excedente registrado</label>
    {ms!==null&&ms<=v.excessMs&&<p>Total proposto: {money(total(ms))}</p>}
    <button type="button" className={btn} disabled={busy||!!pending||ms===null||ms>v.excessMs} onClick={()=>ask('propose_hourly_excess')}>Propor reconhecimento</button></>}
   {v.dispute?.status!=='resolved_administratively'&&p?.status==='pending'&&(p.proposedBy===v.role?<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('withdraw_hourly_excess')}>Retirar proposta</button>:<div className="flex gap-2"><button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('accept_hourly_excess')}>Aceitar reconhecimento</button><button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('decline_hourly_excess')}>Recusar proposta</button></div>)}
  </>}
  {pending&&<div><p>Confirma: {actions[pending.action]}{pending.proposalId?' — '+duration(pending.recognizedExcessMs??p?.recognizedExcessMs??0)+', total '+money(total(pending.recognizedExcessMs??p?.recognizedExcessMs??0)):''}?</p>{pending.action==='dispute_hourly_excess'&&<p>A declaração restringe novas contratações de ambas as partes, sem atribuir culpa.</p>}<button type="button" className={btn} disabled={busy} onClick={()=>void load(pending)}>Confirmar</button>{' '}<button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
 </section>;
}
