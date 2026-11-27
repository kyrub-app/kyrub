import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../utils/firebase';
type Experience={completedServices:number;completedHires:number};
const validCount=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
export function validPublicExperienceResponse(raw:unknown):raw is {experience:Experience|null}{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1||!Object.hasOwn(raw,'experience'))return false;
 const x=(raw as {experience:unknown}).experience;
 if(x===null)return true;
 return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===2&&validCount((x as Experience).completedServices)&&validCount((x as Experience).completedHires);
}
export function publicExperienceCandidateEnabled(){
 return import.meta.env.DEV&&import.meta.env.VITE_KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_TEST_ONLY==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_INDEX_TEST_ONLY==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_CERTIFIED_READ_TEST_ONLY==='true'&&import.meta.env.VITE_KYRUB_FREELANCE_PUBLIC_EXPERIENCE_TEST_ONLY==='true'&&auth.app.options.projectId==='kyrub-security-test'&&typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname);
}
export function PublicProfileExperience({identifier}:{identifier:string}){
 const [user,setUser]=useState(auth.currentUser),[data,setData]=useState<Experience|null>(null),[state,setState]=useState<'idle'|'loading'|'ready'|'unavailable'>('idle');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const clear=()=>{pending.current?.abort();pending.current=null;setData(null);setState('idle');};
  const stop=onAuthStateChanged(auth,next=>{clear();setUser(next);});
  const onHide=()=>{if(document.hidden)clear();};
  document.addEventListener('visibilitychange',onHide);
  return()=>{stop();pending.current?.abort();pending.current=null;document.removeEventListener('visibilitychange',onHide);};
 },[identifier]);
 async function load(){
  if(!user||auth.currentUser!==user||pending.current||!publicExperienceCandidateEnabled())return;
  const ctl=new AbortController();pending.current=ctl;setData(null);setState('loading');
  const live=()=>pending.current===ctl&&!ctl.signal.aborted&&auth.currentUser===user;
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const r=await fetch('/api/freelance/workspace?view=reputation_public_address_experience&identifier='+encodeURIComponent(identifier),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctl.signal});
   const value=await r.json();if(!live())return;
   if(!r.ok||!validPublicExperienceResponse(value)||value.experience===null){setState('unavailable');return;}
   setData(value.experience);setState('ready');
  }catch{if(live())setState('unavailable');}
  finally{if(pending.current===ctl)pending.current=null;}
 }
 if(!publicExperienceCandidateEnabled()||!user||auth.currentUser!==user)return null;
 return <section aria-label="Experiência" className="space-y-3 rounded-2xl border border-slate-700 p-3 text-sm">
  <h2 className="text-base font-bold text-white">Experiência</h2>
  <button type="button" disabled={state==='loading'} onClick={()=>void load()} className="min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-orange-300 disabled:opacity-50">{state==='loading'?'Consultando…':state==='ready'?'Atualizar experiência':'Consultar experiência'}</button>
  {state==='unavailable'&&<p role="status" className="text-slate-400">Experiência indisponível nesta consulta.</p>}
  {state==='ready'&&data&&<div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-slate-700 p-3"><strong className="block text-lg">{data.completedServices.toLocaleString('pt-BR')}</strong><p>Serviços concluídos</p></div><div className="rounded-xl border border-slate-700 p-3"><strong className="block text-lg">{data.completedHires.toLocaleString('pt-BR')}</strong><p>Contratações concluídas</p></div></div>}
 </section>;
}
