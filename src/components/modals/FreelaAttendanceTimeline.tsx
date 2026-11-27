import FreelaAttendanceExtensions from './FreelaAttendanceExtensions';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {projectFreelanceAttendance,type FreelanceAttendanceEvent,type FreelanceAttendanceSchedule} from '../../../shared/freelanceAttendance';
type View={actor:'worker'|'requester';operationalStatus:string;schedule:FreelanceAttendanceSchedule;events:FreelanceAttendanceEvent[];projection:ReturnType<typeof projectFreelanceAttendance>};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const labels:Record<string,string>={scheduled:'Agendado',checked_in:'Chegada registrada',present:'Presença confirmada',waiting:'Em espera',working:'Em execução',paused:'Em intervalo',awaiting_resume:'Aguardando retomada',awaiting_confirmation:'Aguardando confirmação',confirmed:'Encerramento confirmado',suspended:'Suspenso para análise'};
const actions:Record<string,string>={check_in:'Registrar chegada',confirm_presence:'Confirmar presença',authorize_early_start:'Autorizar início antecipado',acknowledge_waiting:'Reconhecer espera',request_break:'Solicitar intervalo',approve_break:'Aprovar intervalo',resume:'Retomar atividade'};
const minutes=(ms:number)=>Math.floor(ms/60000)+' min '+Math.floor(ms/1000)%60+' s';
export default function FreelaAttendanceTimeline({user,offerId}:{user:User;offerId:string}){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<string|null>(null);
 const active=useRef<AbortController|null>(null),eventId=useRef('');
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function load(kind?:string){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const ctl=new AbortController();active.current=ctl;
  const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const headers={authorization:'Bearer '+token,'content-type':'application/json'},url='/api/freelance/workspace';
   if(kind){
    if(!view)throw Error('Consulte a jornada.');
    eventId.current ||=crypto.randomUUID();
    const r=await fetch(url,{method:'POST',headers,signal:ctl.signal,cache:'no-store',body:JSON.stringify({action:'attendance_event',offerId,kind,eventId:eventId.current,expectedSequence:view.events.length,confirmed:true})});
    const ack=await r.json();if(!live())return;if(!r.ok||ack?.confirmed!==true)throw Error('Evento não confirmado. Atualize a jornada.');
    setPending(null);eventId.current='';
   }
   const r=await fetch(url+'?view=attendance&offerId='+encodeURIComponent(offerId),{headers,signal:ctl.signal,cache:'no-store'});
   const data=await r.json();if(!live())return;
   if(!r.ok||!data?.schedule||!['worker','requester'].includes(data.actor)||!Array.isArray(data.events)||typeof data.operationalStatus!=='string')throw Error('Jornada indisponível.');
   const projection=projectFreelanceAttendance(data.schedule,data.events);
   setView({...data,projection});setPending(null);eventId.current='';
  }catch(e){if(live()){setView(null);setPending(null);setError(e instanceof Error?e.message:'Jornada indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 const p=view?.projection,options:string[]=[];
 if(view&&p){
  if(view.operationalStatus==='contracted'){
   if(view.actor==='worker'&&view.schedule.location==='on_site'&&p.status==='scheduled')options.push('check_in');
   if(view.actor==='requester'){
    if(p.status==='checked_in')options.push('confirm_presence');
    if(!p.earlyAuthorized&&Date.now()<Date.parse(view.schedule.scheduledStartAt))options.push('authorize_early_start');
    if(p.status==='present'&&Date.now()>=Date.parse(view.schedule.scheduledStartAt))options.push('acknowledge_waiting');
   }
  }
  if(view.operationalStatus==='in_progress'){
   if(view.actor==='worker'&&p.status==='working'&&!p.breakRequested)options.push('request_break');
   if(view.actor==='requester'&&p.status==='working'&&p.breakRequested)options.push('approve_break');
   if(view.actor==='worker'&&['paused','awaiting_resume'].includes(p.status))options.push('resume');
  }
 }
 return <div className="space-y-2 border-t border-slate-700 pt-3"><h4 className="font-bold">Registro de jornada</h4>
  <button type="button" className={btn} disabled={busy} onClick={()=>void load()}>Atualizar jornada</button>
  {error&&<p role="alert">{error}</p>}
  {p&&<><p>{labels[p.status]} · {view!.events.length} registros</p><p>Períodos encerrados: trabalho {minutes(p.workMs)} · espera {minutes(p.waitMs)} · intervalo {minutes(p.breakMs)}</p><p>Inicie e encerre o serviço pelos controles do contrato. Não representa pagamento confirmado.</p>{p.exceedsAgreedTime&&<p className="text-amber-300">Tempo registrado excede a estimativa. Sem cobrança adicional automática.</p>}</>}
  {options.map(kind=><button key={kind} type="button" className={btn} disabled={busy||!!pending} onClick={()=>{setPending(kind);eventId.current='';}}>{actions[kind]}</button>)}
  {pending&&<div><p>Confirma: {actions[pending]}?</p><button type="button" className={btn} disabled={busy} onClick={()=>void load(pending)}>Confirmar registro</button><button type="button" className={btn} disabled={busy} onClick={()=>setPending(null)}>Voltar</button></div>}
  <FreelaAttendanceExtensions key={offerId} user={user} offerId={offerId}/>
 </div>;
}
