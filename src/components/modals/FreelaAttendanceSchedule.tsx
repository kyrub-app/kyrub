import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {readFreelanceScheduleProposal,type FreelanceScheduleProposal} from '../../../shared/freelanceAttendanceSchedule';
type View={actor:'worker'|'requester';eligible:boolean;schedule:FreelanceScheduleProposal|null;executionIntegrated:false};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const labels={pending:'Aguardando resposta',accepted:'Horário acordado',declined:'Recusada',withdrawn:'Retirada'};
export default function FreelaAttendanceSchedule({user,offerId}:{user:User;offerId:string}){
 const [view,setView]=useState<View|null>(null),[date,setDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null),proposedId=useRef('');
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function request(action?:string){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const controller=new AbortController();active.current=controller;
  const live=()=>!controller.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const headers={authorization:'Bearer '+token,'content-type':'application/json'};
   const root='/api/freelance/workspace';
   if(action){
    let body:Record<string,unknown>={action,offerId,confirmed:true};
    if(action==='propose_schedule'){
     const parsed=new Date(date);if(!Number.isFinite(parsed.getTime())||parsed.getTime()<=Date.now())throw Error('Informe um horário futuro.');
     proposedId.current ||=crypto.randomUUID();
     body={...body,proposalId:proposedId.current,scheduledStartAt:parsed.toISOString()};
    }else{if(!view?.schedule)throw Error('Consulte a proposta.');body.proposalId=view.schedule.id;}
    const r=await fetch(root,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,cache:'no-store'});
    const ack=await r.json();if(!live())return;
    if(!r.ok||ack?.confirmed!==true)throw Error('Não foi possível confirmar a operação. Consulte novamente.');
    proposedId.current='';setDate('');
   }
   const r=await fetch(root+'?view=attendance_schedule&offerId='+encodeURIComponent(offerId),{headers,signal:controller.signal,cache:'no-store'});
   const data=await r.json();if(!live())return;
   if(!r.ok||!['worker','requester'].includes(data?.actor)||typeof data.eligible!=='boolean'||data.executionIntegrated!==false)throw Error('Agenda indisponível.');
   setView({...data,schedule:data.schedule===null?null:readFreelanceScheduleProposal(data.schedule)});
  }catch(e){if(live()){setView(null);setError(e instanceof Error?e.message:'Agenda indisponível.');}}
  finally{if(active.current===controller){active.current=null;if(live())setBusy(false);}}
 }
 const s=view?.schedule;
 return <section className="space-y-2 rounded-xl border border-slate-700 p-3">
  <h4 className="text-base font-bold">Horário combinado</h4>
  <p>Agenda em homologação. Ainda não controla o início, registro de presença ou pagamento.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void request()}>Consultar agenda</button>
  {error&&<p role="alert">{error}</p>}
  {s&&<><p>{labels[s.status]} · {new Date(s.schedule.scheduledStartAt).toLocaleString('pt-BR')} · {s.schedule.agreedMinutes} min</p><p>{s.schedule.location==='remote'?'Remoto':'Presencial'}</p></>}
  {view?.eligible&&(!s||s.status==='declined'||s.status==='withdrawn')&&<><label className="block">Data e horário propostos<input type="datetime-local" className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2" value={date} disabled={busy} onChange={e=>{setDate(e.target.value);proposedId.current='';}}/></label><button type="button" className={btn} disabled={busy||!date} onClick={()=>void request('propose_schedule')}>Propor horário</button></>}
  {view?.eligible&&s?.status==='pending'&&(s.proposedBy===view.actor?<button type="button" className={btn} disabled={busy} onClick={()=>void request('withdraw_schedule')}>Retirar proposta</button>:<div className="flex flex-wrap gap-2"><button type="button" className={btn} disabled={busy} onClick={()=>void request('accept_schedule')}>Aceitar horário</button><button type="button" className={btn} disabled={busy} onClick={()=>void request('decline_schedule')}>Recusar horário</button></div>)}
 </section>;
}
