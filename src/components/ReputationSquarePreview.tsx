import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {publicReputationCandidateEnabled,validPublicSummaryResponse} from './PublicProfileExperience';
type Summary={experience:{completedServices:number;completedHires:number};reputations:{professional:{ratingCount:number;mean:number|null};personalRequester:{ratingCount:number;mean:number|null}}};
export function reputationSquareCandidateEnabled(){return publicReputationCandidateEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_SQUARE_TEST_ONLY==='true';}
export function ReputationPublicationIndicators({summary}:{summary:Summary}){
 return <div className="space-y-3 text-sm">
  <p className="text-slate-200">Conheça minha Experiência e Reputações no Kyrub!</p>
  <h4 className="text-base font-bold text-white">Experiência</h4>
  <div className="grid grid-cols-2 gap-2">
   <div className="rounded-xl border border-slate-700 p-3"><strong className="block text-lg">{summary.experience.completedServices.toLocaleString('pt-BR')}</strong><p>Serviços concluídos</p></div>
   <div className="rounded-xl border border-slate-700 p-3"><strong className="block text-lg">{summary.experience.completedHires.toLocaleString('pt-BR')}</strong><p>Contratações concluídas</p></div>
  </div>
  <h4 className="text-base font-bold text-white">Reputações</h4>
  <div className="grid grid-cols-2 gap-2">{([['Profissional',summary.reputations.professional],['Contratante pessoal',summary.reputations.personalRequester]] as const).map(([label,r])=><div key={label} className="rounded-xl border border-slate-700 p-3"><p>{label}</p><strong className="block text-lg text-amber-300">{r.mean===null?'Sem avaliações':r.mean.toLocaleString('pt-BR',{maximumFractionDigits:2})+' ★'}</strong><p className="text-slate-400">{r.ratingCount.toLocaleString('pt-BR')} avaliações</p></div>)}</div>
 </div>;
}
export function ReputationSquarePreview({user,identifier}:{user:User;identifier:string}){
 const [summary,setSummary]=useState<Summary|null>(null),[status,setStatus]=useState<'idle'|'loading'|'unavailable'|'ready'>('idle');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const clear=()=>{pending.current?.abort();pending.current=null;setSummary(null);setStatus('idle');};
  const stop=onAuthStateChanged(auth,next=>{if(next!==user)clear();});
  const hide=()=>{if(document.hidden)clear();};
  document.addEventListener('visibilitychange',hide);
  return()=>{stop();pending.current?.abort();pending.current=null;document.removeEventListener('visibilitychange',hide);};
 },[user,identifier]);
 async function load(){
  if(!reputationSquareCandidateEnabled()||auth.currentUser!==user||pending.current)return;
  const ctrl=new AbortController();pending.current=ctrl;setSummary(null);setStatus('loading');
  const live=()=>pending.current===ctrl&&!ctrl.signal.aborted&&auth.currentUser===user;
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const res=await fetch('/api/freelance/workspace?view=reputation_square_preview&identifier='+encodeURIComponent(identifier),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctrl.signal});
   const value=await res.json();if(!live())return;
   if(!res.ok||!validPublicSummaryResponse(value)||!value.experience||!value.reputations){setStatus('unavailable');return;}
   setSummary({experience:value.experience,reputations:value.reputations});setStatus('ready');
  }catch{if(live())setStatus('unavailable');}
  finally{if(pending.current===ctrl)pending.current=null;}
 }
 if(!reputationSquareCandidateEnabled()||auth.currentUser!==user)return null;
 return <section className="space-y-2 rounded-xl border border-slate-700 p-3" aria-label="Prévia de compartilhamento na Praça">
  <h4 className="text-base font-bold text-white">Compartilhar na Praça</h4>
  <p className="text-slate-400">Prévia de homologação. Os indicadores são conferidos pelo sistema, sem edição manual.</p>
  <button type="button" disabled={status==='loading'} onClick={()=>void load()} className="min-h-11 rounded-xl border border-slate-700 px-3 py-2 font-bold">{status==='loading'?'Consultando…':status==='ready'?'Atualizar prévia':'Visualizar publicação'}</button>
  {status==='unavailable'&&<p role="status">Indicadores indisponíveis nesta consulta.</p>}
  {status==='ready'&&summary&&<div className="space-y-3 rounded-xl border border-slate-700 p-3"><ReputationPublicationIndicators summary={summary}/><div className="flex flex-wrap justify-between gap-2 border-t border-slate-700 pt-3 text-slate-400" aria-label="Ações previstas na publicação"><span>Semear</span><span>Comentar</span><span>Encaminhar</span></div><p className="text-slate-400">Prévia apenas. Nenhuma publicação enviada.</p></div>}
 </section>;
}
