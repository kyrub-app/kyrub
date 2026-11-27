import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Rating={subject:{kind:'professional'|'personal_requester'|'store_requester';id:string};stars:number;submittedAt:string};
type View={offerId:string;role:'requester'|'worker';own:Rating|null;received:Rating|null;publicationState:'bilateral_released'|'waiting_bilateral';rewardsGranted:false};
type Contest={offerId:string;eligible:boolean;ratingDigest:string|null;contestation:{status:'pending';reason:string;requestedAt:string}|null};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const field='w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-white';
const labels={professional:'Profissional',personal_requester:'Contratante pessoal',store_requester:'Contratante empresarial'};
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
function rating(v:unknown):v is Rating{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const r=v as Rating;
 return Object.keys(r).length===3&&!!r.subject&&Object.keys(r.subject).length===2&&Object.hasOwn(labels,r.subject.kind)&&id(r.subject.id)&&Number.isInteger(r.stars)&&r.stars>=1&&r.stars<=5&&date(r.submittedAt);
}
function validView(v:unknown,offerId:string,role:View['role']):v is View{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const r=v as View;
 return Object.keys(r).length===6&&r.offerId===offerId&&r.role===role&&r.rewardsGranted===false&&(r.own===null||rating(r.own))&&(r.received===null||rating(r.received))&&
 (r.own===null||(role==='requester'?r.own.subject.kind==='professional':r.own.subject.kind!=='professional'))&&
 (r.received===null||(role==='worker'?r.received.subject.kind==='professional':r.received.subject.kind!=='professional'))&&
 (r.publicationState==='bilateral_released'?!!r.own&&!!r.received:r.publicationState==='waiting_bilateral'&&r.received===null);
}
function validContest(v:unknown,offerId:string):v is Contest{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const c=v as Contest;
 return Object.keys(c).length===4&&c.offerId===offerId&&typeof c.eligible==='boolean'&&(c.ratingDigest===null||digest(c.ratingDigest))&&
 (c.contestation===null||(c.contestation.status==='pending'&&typeof c.contestation.reason==='string'&&c.contestation.reason.length<=1000&&date(c.contestation.requestedAt)))&&
 (!c.eligible||!!c.ratingDigest&&c.contestation===null)&&(!c.contestation||!!c.ratingDigest&&!c.eligible);
}
export function freelaReputationCandidateEnabled(){
 return import.meta.env.DEV&&import.meta.env.VITE_KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_TEST_ONLY==='true'&&auth.app.options.projectId==='kyrub-security-test'&&typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname);
}
export default function FreelaReputationPanel({user,offerId,role}:{user:User;offerId:string;role:View['role']}){
 const [view,setView]=useState<View|null>(null),[contest,setContest]=useState<Contest|null>(null),[stars,setStars]=useState(0),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function run(action?:'submit_reputation'|'contest_reputation'){
  if(active.current||auth.currentUser?.uid!==user.uid||!freelaReputationCandidateEnabled())return;
  if(action==='submit_reputation'&&(!view||view.own||!confirmed||stars<1||stars>5))return;
  if(action==='contest_reputation'&&(!contest?.eligible||!contest.ratingDigest||!reason.trim()||!confirmed))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>active.current===ctl&&!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setView(null);setContest(null);
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const endpoint='/api/freelance/workspace',headers={authorization:'Bearer '+token};
   if(action){
    const body=action==='submit_reputation'?{action,offerId,confirmed:true,stars}:{action,offerId,confirmed:true,ratingDigest:contest!.ratingDigest,reason:reason.trim()};
    const response=await fetch(endpoint,{method:'POST',cache:'no-store',signal:ctl.signal,headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!live())return;if(!response.ok||result?.confirmed!==true)throw Error('Solicitação não confirmada. Consulte novamente.');
   }
   const read=async(name:string)=>{const r=await fetch(endpoint+'?view='+name+'&offerId='+encodeURIComponent(offerId),{method:'GET',cache:'no-store',signal:ctl.signal,headers});const v=await r.json();if(!r.ok)throw Error('Consulta não autorizada ou indisponível.');return v;};
   const v=await read('reputation');if(!live())return;if(!validView(v,offerId,role))throw Error('Resposta de reputação não confirmada.');
   const c=await read('reputation_contestation');if(!live())return;if(!validContest(c,offerId)||(!v.received&&c.ratingDigest!==null))throw Error('Resposta de contestação não confirmada.');
   setView(v);setContest(c);setConfirmed(false);setStars(0);setReason('');
  }catch(e){if(live())setError(e instanceof Error?e.message:'Consulta indisponível.');}
  finally{if(active.current===ctl){if(live())setBusy(false);active.current=null;}}
 }
 if(!freelaReputationCandidateEnabled()||auth.currentUser?.uid!==user.uid)return null;
 return <section className="space-y-3 border-t border-slate-700 pt-3" aria-label="Reputações">
  <h3 className="text-base font-bold text-white">Reputações</h3><p>Homologação isolada. Escala de teste, sem recompensa ou publicação pública.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void run()}>Consultar reputações</button>
  {busy&&<p role="status">Consultando servidor…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}
  {view&&<><p>{view.publicationState==='bilateral_released'?'Avaliações disponibilizadas às duas partes.':'A avaliação recebida fica reservada até o envio das duas partes.'}</p>
   {view.own?<p>Avaliação enviada: {view.own.stars}/5 · {labels[view.own.subject.kind]}</p>:<form className="space-y-2" onSubmit={e=>{e.preventDefault();void run('submit_reputation');}}>
    <label className="block">Avaliação de teste<select className={field} value={stars} onChange={e=>{setStars(Number(e.target.value));setConfirmed(false);}}><option value={0}>Selecione</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}/5</option>)}</select></label>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo o envio da avaliação.</label>
    <button type="submit" className={btn} disabled={busy||!confirmed||!stars}>Enviar avaliação de teste</button>
   </form>}
   {view.received&&<p>Avaliação recebida: {view.received.stars}/5 · {labels[view.received.subject.kind]}</p>}
   {contest?.contestation&&<div><p>Contestação pendente de análise</p><p className="whitespace-pre-wrap break-words">{contest.contestation.reason}</p></div>}
   {contest?.eligible&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void run('contest_reputation');}}>
    <label className="block">Justificativa privada<textarea className={field} value={reason} maxLength={1000} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a contestação da avaliação recebida.</label>
    <button type="submit" className={btn} disabled={busy||!confirmed||!reason.trim()}>Contestar avaliação</button>
   </form>}
  </>}
 </section>;
}
