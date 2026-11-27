import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../utils/firebase';
type Experience={completedServices:number;completedHires:number};
type RatingSummary={ratingCount:number;mean:number|null};
type Reputations={professional:RatingSummary;personalRequester:RatingSummary};
type Summary={experience:Experience|null;reputations:Reputations|null};
const validCount=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function validPublicExperienceResponse(raw:unknown):raw is {experience:Experience|null}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1||!Object.hasOwn(raw,'experience'))return false;
 const x=(raw as {experience:unknown}).experience;
 if(x===null)return true;
 return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===2&&validCount((x as Experience).completedServices)&&validCount((x as Experience).completedHires);
}
function validRatingSummary(v:unknown,max:number):v is RatingSummary{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==2)return false;
 const r=v as RatingSummary;
 return validCount(r.ratingCount)&&r.ratingCount<=max&&(r.ratingCount===0?r.mean===null:typeof r.mean==='number'&&Number.isFinite(r.mean)&&r.mean>=1&&r.mean<=5);
}
export function validPublicSummaryResponse(raw:unknown):raw is Summary{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!Object.hasOwn(raw,'reputations'))return false;
 const r=raw as Summary;
 if(!validPublicExperienceResponse({experience:r.experience}))return false;
 if(r.experience===null)return r.reputations===null;
 const v=r.reputations;
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===2&&validRatingSummary(v.professional,r.experience.completedServices)&&validRatingSummary(v.personalRequester,r.experience.completedHires);
}
export function publicExperienceCandidateEnabled(){
 return import.meta.env.DEV&&import.meta.env.VITE_KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_TEST_ONLY==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_INDEX_TEST_ONLY==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_CERTIFIED_READ_TEST_ONLY==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_PUBLIC_EXPERIENCE_TEST_ONLY==='true'&&auth.app.options.projectId==='kyrub-security-test'&&typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname);
}
export function publicReputationCandidateEnabled(){return publicExperienceCandidateEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_PUBLIC_REPUTATION_TEST_ONLY==='true';}
export function PublicProfileExperience({identifier}:{identifier:string}){
 const [user,setUser]=useState(auth.currentUser),[data,setData]=useState<Experience|null>(null),[state,setState]=useState<'idle'|'loading'|'ready'|'unavailable'>('idle');
 const [reputations,setReputations]=useState<Reputations|null>(null);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const clear=()=>{pending.current?.abort();pending.current=null;setData(null);setReputations(null);setState('idle');};
  const stop=onAuthStateChanged(auth,next=>{clear();setUser(next);});
  const onHide=()=>{if(document.hidden)clear();};
  document.addEventListener('visibilitychange',onHide);
  return()=>{stop();pending.current?.abort();pending.current=null;document.removeEventListener('visibilitychange',onHide);};
 },[identifier]);
 async function load(){
  if(!user||auth.currentUser!==user||pending.current||!publicExperienceCandidateEnabled())return;
  const ctl=new AbortController();pending.current=ctl;setData(null);setReputations(null);setState('loading');
  const live=()=>pending.current===ctl&&!ctl.signal.aborted&&auth.currentUser===user;
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const withReputation=publicReputationCandidateEnabled();
   const path=withReputation?'/api/freelance/workspace?view=reputation_public_address_summary&identifier=':'/api/freelance/workspace?view=reputation_public_address_experience&identifier=';
   const r=await fetch(path+encodeURIComponent(identifier),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctl.signal});
   const value=await r.json();if(!live())return;
   if(!r.ok){setState('unavailable');return;}
   if(withReputation){
    if(!validPublicSummaryResponse(value)||value.experience===null||!value.reputations){setState('unavailable');return;}
    setData(value.experience);setReputations(value.reputations);
   }else{
    if(!validPublicExperienceResponse(value)||value.experience===null){setState('unavailable');return;}
    setData(value.experience);
   }
   setState('ready');
  }catch{if(live())setState('unavailable');}
  finally{if(pending.current===ctl)pending.current=null;}
 }
 if(!publicExperienceCandidateEnabled()||!user||auth.currentUser!==user)return null;
 return <section aria-label="Experiência" className="space-y-3 rounded-2xl border border-slate-700 p-3 text-sm">
  <h2 className="text-base font-bold text-white">Experiência</h2>
  <button type="button" disabled={state==='loading'} onClick={()=>void load()} className="min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-orange-300 disabled:opacity-50">{state==='loading'?'Consultando…':state==='ready'?'Atualizar experiência':'Consultar experiência'}</button>
  {state==='unavailable'&&<p role="status" className="text-slate-400">Experiência indisponível nesta consulta.</p>}
  {state==='ready'&&data&&<div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-slate-700 p-3"><strong className="block text-lg">{data.completedServices.toLocaleString('pt-BR')}</strong><p>Serviços concluídos</p></div><div className="rounded-xl border border-slate-700 p-3"><strong className="block text-lg">{data.completedHires.toLocaleString('pt-BR')}</strong><p>Contratações concluídas</p></div></div>}
  {state==='ready'&&reputations&&publicReputationCandidateEnabled()&&<div className="space-y-2 border-t border-slate-700 pt-3">
   <h3 className="text-base font-bold text-white">Reputações</h3>
   <div className="grid grid-cols-2 gap-2">
    {([['Profissional',reputations.professional],['Contratante pessoal',reputations.personalRequester]] as const).map(([label,r])=><div key={label} className="rounded-xl border border-slate-700 p-3"><p>{label}</p><strong className="block text-lg text-amber-300">{r.mean===null?'Sem avaliações':r.mean.toLocaleString('pt-BR',{maximumFractionDigits:2})+' ★'}</strong><p className="text-slate-400">{r.ratingCount.toLocaleString('pt-BR')} avaliações liberadas</p></div>)}
   </div>
  </div>}
 </section>;
}
