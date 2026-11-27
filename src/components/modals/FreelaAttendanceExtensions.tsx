import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {readFreelanceExtensionProposal,type FreelanceExtensionProposal} from '../../../shared/freelanceAttendanceExtensions';
type View={actor:'worker'|'requester';eligible:boolean;records:FreelanceExtensionProposal[];sequence:number;authorizedMinutes:number;mode:'fixed'|'hourly'};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const labels={pending:'Aguardando resposta',accepted:'Aceita',declined:'Recusada',withdrawn:'Retirada'};
export default function FreelaAttendanceExtensions({user,offerId}:{user:User;offerId:string}){
 const [view,setView]=useState<View|null>(null),[minutes,setMinutes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<string|null>(null);
 const active=useRef<AbortController|null>(null),proposalId=useRef('');
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function load(action?:string){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const headers={authorization:'Bearer '+token,'content-type':'application/json'},url='/api/freelance/workspace';
   if(action){
    if(!view)throw Error('Consulte as extensões.');
    let body:Record<string,unknown>={action,offerId,confirmed:true,expectedSequence:view.sequence};
    if(action==='propose_extension'){
     if(!/^\d{1,5}$/.test(minutes)||Number(minutes)<1||Number(minutes)>10080-view.authorizedMinutes)throw Error('Informe minutos adicionais válidos.');
     proposalId.current ||=crypto.randomUUID();body={...body,proposalId:proposalId.current,extraMinutes:Number(minutes)};
    }else{const current=view.records.at(-1);if(!current)throw Error('Consulte a proposta.');body.proposalId=current.id;}
    const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:ctl.signal,cache:'no-store'});const ack=await r.json();if(!live())return;
    if(!r.ok||ack?.confirmed!==true)throw Error('Operação não confirmada. Consulte novamente.');
    proposalId.current='';setMinutes('');setPending(null);
   }
   const r=await fetch(url+'?view=attendance_extensions&offerId='+encodeURIComponent(offerId),{headers,signal:ctl.signal,cache:'no-store'});const data=await r.json();if(!live())return;
   if(!r.ok||!['worker','requester'].includes(data?.actor)||!['fixed','hourly'].includes(data.mode)||typeof data.eligible!=='boolean'||!Array.isArray(data.records)||!Number.isSafeInteger(data.sequence)||!Number.isSafeInteger(data.authorizedMinutes))throw Error('Extensões indisponíveis.');
   setView({...data,records:data.records.map(readFreelanceExtensionProposal)});setPending(null);
  }catch(e){if(live()){setView(null);setPending(null);setError(e instanceof Error?e.message:'Extensões indisponíveis.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 const current=view?.records.at(-1);
 const actions:Record<string,string>={propose_extension:'Propor extensão',accept_extension:'Aceitar extensão',decline_extension:'Recusar extensão',withdraw_extension:'Retirar proposta'};
 return <section className="space-y-2 border-t border-slate-700 pt-3"><h4 className="font-bold">Extensão de jornada</h4>
  <button type="button" className={btn} disabled={busy} onClick={()=>void load()}>Consultar extensões</button>
  {error&&<p role="alert">{error}</p>}
  {view&&<><p>Tempo autorizado: {view.authorizedMinutes} minutos</p><p>{view.mode==='fixed'?'A extensão não altera o valor fechado do serviço.':'A extensão altera o limite de tempo autorizado, não confirma pagamento.'}</p>
   {view.records.map(r=><p key={r.id}>{r.extraMinutes} min · {labels[r.status]}</p>)}
   {view.eligible&&current?.status!=='pending'&&<><label className="block">Minutos adicionais<input className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2" inputMode="numeric" value={minutes} disabled={busy||!!pending} onChange={e=>{setMinutes(e.target.value);proposalId.current='';}}/></label><button type="button" className={btn} disabled={busy||!!pending||!minutes} onClick={()=>setPending('propose_extension')}>Propor extensão</button></>}
   {current?.status==='pending'&&(current.proposedBy===view.actor?<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('withdraw_extension')}>Retirar proposta</button>:<div className="flex gap-2"><button type="button" className={btn} disabled={busy||!!pending||!view.eligible} onClick={()=>setPending('accept_extension')}>Aceitar extensão</button><button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('decline_extension')}>Recusar extensão</button></div>)}
  </>}
  {pending&&<div><p>Confirma: {actions[pending]}?</p><button type="button" className={btn} disabled={busy} onClick={()=>void load(pending)}>Confirmar</button><button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
 </section>;
}
