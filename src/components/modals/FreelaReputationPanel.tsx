import {reputationCriteria,reputationCriterionDescriptions,projectReputationRating,type ReputationScores} from '../../../shared/freelanceReputationCriteria';
import {useEffect,useId,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Rating={subject:{kind:'professional'|'personal_requester'|'store_requester';id:string};scores:ReputationScores;mean:number;applicableCount:number;submittedAt:string};
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
 if(!r.subject)return false;
 try{const p=projectReputationRating(r.subject.kind,r.scores);if(p.mean!==r.mean||p.applicableCount!==r.applicableCount)return false;}catch{return false;}
 return Object.keys(r).length===5&&!!r.subject&&Object.keys(r.subject).length===2&&Object.hasOwn(labels,r.subject.kind)&&id(r.subject.id)&&date(r.submittedAt);
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
 const [view,setView]=useState<View|null>(null),[contest,setContest]=useState<Contest|null>(null),[scores,setScores]=useState<Record<string,string>>({}),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const targetKind=role==='requester'?'professional':'personal_requester';
 const criteria=reputationCriteria(targetKind),descriptions=reputationCriterionDescriptions(targetKind);
 const formId=useId();
 const scoreInput=()=>Object.fromEntries(Object.entries(scores).map(([k,v])=>[k,v==='na'?null:Number(v)]));
 const complete=Object.keys(criteria).every(k=>['1','2','3','4','5','na'].includes(scores[k]))&&Object.values(scores).some(v=>v!=='na'&&v!=='');
 const applicable=Object.keys(criteria).map(k=>Number(scores[k])).filter(n=>Number.isInteger(n)&&n>=1&&n<=5);
 const previewMean=applicable.length?applicable.reduce((a,b)=>a+b,0)/applicable.length:null;
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function run(action?:'submit_reputation'|'contest_reputation'){
  if(active.current||auth.currentUser?.uid!==user.uid||!freelaReputationCandidateEnabled())return;
  if(action==='submit_reputation'&&(!view||view.own||!confirmed||!complete))return;
  if(action==='contest_reputation'&&(!contest?.eligible||!contest.ratingDigest||!reason.trim()||!confirmed))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>active.current===ctl&&!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setView(null);setContest(null);
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const endpoint='/api/freelance/workspace',headers={authorization:'Bearer '+token};
   if(action){
    const body=action==='submit_reputation'?{action,offerId,confirmed:true,scores:scoreInput()}:{action,offerId,confirmed:true,ratingDigest:contest!.ratingDigest,reason:reason.trim()};
    const response=await fetch(endpoint,{method:'POST',cache:'no-store',signal:ctl.signal,headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!live())return;if(!response.ok||result?.confirmed!==true)throw Error('Solicitação não confirmada. Consulte novamente.');
   }
   const read=async(name:string)=>{const r=await fetch(endpoint+'?view='+name+'&offerId='+encodeURIComponent(offerId),{method:'GET',cache:'no-store',signal:ctl.signal,headers});const v=await r.json();if(!r.ok)throw Error('Consulta não autorizada ou indisponível.');return v;};
   const v=await read('reputation');if(!live())return;if(!validView(v,offerId,role))throw Error('Resposta de reputação não confirmada.');
   const c=await read('reputation_contestation');if(!live())return;if(!validContest(c,offerId)||(!v.received&&c.ratingDigest!==null))throw Error('Resposta de contestação não confirmada.');
   setView(v);setContest(c);setConfirmed(false);setScores({});setReason('');
  }catch(e){if(live())setError(e instanceof Error?e.message:'Consulta indisponível.');}
  finally{if(active.current===ctl){if(live())setBusy(false);active.current=null;}}
 }
 if(!freelaReputationCandidateEnabled()||auth.currentUser?.uid!==user.uid)return null;
 return <section className="space-y-3 border-t border-slate-700 pt-3" aria-label="Reputações">
  <h3 className="text-base font-bold text-white">Reputações</h3><p>Homologação isolada. Avalie condutas e condições observadas, sem recompensa ou publicação pública.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void run()}>Consultar reputações</button>
  {busy&&<p role="status">Consultando servidor…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}
  {view&&<><p>{view.publicationState==='bilateral_released'?'Avaliações disponibilizadas às duas partes.':'A avaliação recebida fica reservada até o envio das duas partes.'}</p>
   {view.own?<p>Avaliação enviada: {view.own.mean.toLocaleString('pt-BR',{maximumFractionDigits:2})}/5 · {labels[view.own.subject.kind]}</p>:<form className="space-y-2" onSubmit={e=>{e.preventDefault();void run('submit_reputation');}}>
    <p className="text-sm text-slate-300">Selecione de uma a cinco estrelas em cada critério, ou Não se aplica quando não puder avaliá-lo.</p>
    {Object.entries(criteria).map(([k,label])=><fieldset key={k} disabled={busy} aria-describedby={formId+'-'+k+'-description'} className="min-w-0 space-y-2 border-b border-slate-800 pb-3">
     <legend className="text-sm font-bold text-white">{label}</legend>
     <p id={formId+'-'+k+'-description'} className="text-sm text-slate-400">{descriptions[k]}</p>
     <div className="flex flex-wrap items-center gap-1">
      {[1,2,3,4,5].map(n=><label key={n} className="relative flex min-h-11 min-w-10 cursor-pointer items-center justify-center rounded-lg focus-within:ring-2 focus-within:ring-teal-300">
       <input type="radio" className="sr-only" name={formId+'-'+k} value={String(n)} checked={scores[k]===String(n)} aria-label={label+': '+n+(n===1?' estrela':' estrelas')} onChange={()=>{setScores(prev=>({...prev,[k]:String(n)}));setConfirmed(false);}}/>
       <span aria-hidden="true" className={'text-2xl '+(Number(scores[k])>=n?'text-amber-300':'text-slate-400')}>{Number(scores[k])>=n?'★':'☆'}</span>
      </label>)}
      <label className="ml-1 flex min-h-11 items-center gap-2 text-sm text-slate-300"><input type="radio" name={formId+'-'+k} value="na" checked={scores[k]==='na'} onChange={()=>{setScores(prev=>({...prev,[k]:'na'}));setConfirmed(false);}}/>Não se aplica</label>
     </div>
    </fieldset>)}
    <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 p-3 text-sm" aria-live="polite"><div><p className="font-bold text-white">Média da avaliação</p><p className="text-slate-400">{applicable.length} critérios pontuados · {complete?'Pronta para confirmar':'Preencha todos os critérios'}</p></div><strong className="text-base text-amber-300">{previewMean===null?'—':previewMean.toLocaleString('pt-BR',{maximumFractionDigits:2})+' / 5'}</strong></div>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo o envio da avaliação.</label>
    <button type="submit" className={btn} disabled={busy||!confirmed||!complete}>Enviar avaliação</button>
   </form>}
   {view.received&&<div><p>Avaliação recebida: {view.received.mean.toLocaleString('pt-BR',{maximumFractionDigits:2})}/5 · {labels[view.received.subject.kind]}</p><dl>{Object.entries(reputationCriteria(view.received.subject.kind)).map(([k,label])=><div key={k} className="flex justify-between gap-2"><dt>{label}</dt><dd>{view.received!.scores[k]===null?'Não se aplica':view.received!.scores[k]+'/5'}</dd></div>)}</dl></div>}
   {contest?.contestation&&<div><p>Contestação pendente de análise</p><p className="whitespace-pre-wrap break-words">{contest.contestation.reason}</p></div>}
   {contest?.eligible&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void run('contest_reputation');}}>
    <label className="block">Justificativa privada<textarea className={field} value={reason} maxLength={1000} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a contestação da avaliação recebida.</label>
    <button type="submit" className={btn} disabled={busy||!confirmed||!reason.trim()}>Contestar avaliação</button>
   </form>}
  </>}
 </section>;
}
