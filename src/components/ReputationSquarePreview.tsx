import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Forward} from 'lucide-react';
import type {Friend} from '../types';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {publicReputationCandidateEnabled,validPublicSummaryResponse} from './PublicProfileExperience';
export type Summary={experience:{completedServices:number;completedHires:number};reputations:{professional:{ratingCount:number;mean:number|null};personalRequester:{ratingCount:number;mean:number|null}}};
export function reputationSquareCandidateEnabled(){return publicReputationCandidateEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_SQUARE_TEST_ONLY==='true';}
export function reputationSquarePublishEnabled(){return reputationSquareCandidateEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_SQUARE_PUBLISH_TEST_ONLY==='true';}
export function reputationSquareForwardEnabled(){return reputationSquarePublishEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_SQUARE_FORWARD_TEST_ONLY==='true';}
export function reputationDirectForwardEnabled(){return reputationSquareForwardEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_DIRECT_FORWARD_TEST_ONLY==='true';}
export const isReputationSquarePost=(id:string)=>/^reputation_[a-f0-9]{64}$/.test(id);
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
 const requestId=useRef<string|null>(null),posting=useRef(false);
 const [publishState,setPublishState]=useState<'idle'|'sending'|'failed'|'published'>('idle');
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
 async function publish(){
  if(!reputationSquarePublishEnabled()||auth.currentUser!==user||!summary||status!=='ready'||posting.current||publishState==='published')return;
  posting.current=true;setPublishState('sending');
  try{
   requestId.current??=crypto.randomUUID();
   const token=await user.getIdToken(true);
   if(auth.currentUser!==user)return;
   const res=await fetch('/api/freelance/workspace',{method:'POST',cache:'no-store',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action:'publish_reputation_square',identifier,requestId:requestId.current,confirmed:true})});
   const value=await res.json();
   if(auth.currentUser!==user)return;
   if(!res.ok||value?.confirmed!==true)throw Error('PUBLICATION_UNCONFIRMED');
   setPublishState('published');
  }catch{if(auth.currentUser===user)setPublishState('failed');}
  finally{posting.current=false;}
 }
 if(!reputationSquareCandidateEnabled()||auth.currentUser!==user)return null;
 return <section className="space-y-2 rounded-xl border border-slate-700 p-3" aria-label="Prévia de compartilhamento na Praça">
  <h4 className="text-base font-bold text-white">Compartilhar na Praça</h4>
  <p className="text-slate-400">Prévia de homologação. Os indicadores são conferidos pelo sistema, sem edição manual.</p>
  <button type="button" disabled={status==='loading'} onClick={()=>void load()} className="min-h-11 rounded-xl border border-slate-700 px-3 py-2 font-bold">{status==='loading'?'Consultando…':status==='ready'?'Atualizar prévia':'Visualizar publicação'}</button>
  {status==='unavailable'&&<p role="status">Indicadores indisponíveis nesta consulta.</p>}
  {status==='ready'&&summary&&<div className="space-y-3 rounded-xl border border-slate-700 p-3"><ReputationPublicationIndicators summary={summary}/><div className="flex flex-wrap justify-between gap-2 border-t border-slate-700 pt-3 text-slate-400" aria-label="Ações previstas na publicação"><span>Semear</span><span>Comentar</span><span>Encaminhar</span></div>{reputationSquarePublishEnabled()?<><p className="text-slate-400">Ao confirmar, seus indicadores serão compartilhados na Praça por 24 horas.</p><button type="button" disabled={publishState==='sending'||publishState==='published'} onClick={()=>void publish()} className="min-h-11 w-full rounded-xl bg-orange-500 px-3 py-2 font-bold text-slate-950 disabled:opacity-50">{publishState==='sending'?'Publicando…':publishState==='published'?'Publicação confirmada':publishState==='failed'?'Tentar novamente':'Confirmar publicação na Praça'}</button>{publishState==='failed'&&<p role="status">Não foi possível confirmar o envio. Tente novamente com a mesma solicitação.</p>}</>:<p className="text-slate-400">Prévia apenas. Nenhuma publicação enviada.</p>}</div>}
 </section>;
}

/** Load only visible reputation cards. The feed document is a reference, never
 * a source for numerical indicators. Hide the complete article until the
 * authenticated server read verifies it. No polling or persistent cache. */
export function ReputationSquarePostGate({postId,viewerId,createdAt,render}:{postId:string;viewerId:string;createdAt:string;render:(summary:Summary)=>ReactNode}){
 const holder=useRef<HTMLDivElement|null>(null);
 const [visible,setVisible]=useState(false),[summary,setSummary]=useState<Summary|null>(null),[failed,setFailed]=useState(false),[tabVisible,setTabVisible]=useState(!document.hidden);
 const expiresAt=Date.parse(createdAt)+86400000;
 const [expired,setExpired]=useState(!Number.isFinite(expiresAt)||Date.now()>=expiresAt);
 useEffect(()=>{
  const target=holder.current;if(!target)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{rootMargin:'0px'});
  observer.observe(target);return()=>observer.disconnect();
 },[postId]);
 useEffect(()=>{
  const onVisibility=()=>setTabVisible(!document.hidden);
  document.addEventListener('visibilitychange',onVisibility);
  const stop=onAuthStateChanged(auth,next=>{if(next?.uid!==viewerId)setSummary(null);});
  return()=>{stop();document.removeEventListener('visibilitychange',onVisibility);};
 },[viewerId]);
 useEffect(()=>{
  const remaining=expiresAt-Date.now();setExpired(!Number.isFinite(remaining)||remaining<=0);
  if(Number.isFinite(remaining)&&remaining>0){const timer=window.setTimeout(()=>{setExpired(true);setSummary(null);},remaining);return()=>window.clearTimeout(timer);}
 },[expiresAt]);
 useEffect(()=>{
  setSummary(null);setFailed(false);
  const user=auth.currentUser;
  if(!visible||!tabVisible||expired||Date.now()>=expiresAt||!reputationSquarePublishEnabled()||!isReputationSquarePost(postId)||!user||user.uid!==viewerId)return;
  const ctrl=new AbortController();
  const live=()=>!ctrl.signal.aborted&&auth.currentUser===user&&Date.now()<expiresAt;
  void (async()=>{
   try{
    const token=await user.getIdToken(true);if(!live())return;
    const res=await fetch('/api/freelance/workspace?view=reputation_square_post&offerId='+encodeURIComponent(postId),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctrl.signal});
    const value=await res.json();if(!live())return;
    if(!res.ok||!validPublicSummaryResponse(value)||!value.experience||!value.reputations){setFailed(true);return;}
    setSummary({experience:value.experience,reputations:value.reputations});
   }catch{if(live())setFailed(true);}
  })();
  return()=>ctrl.abort();
 },[postId,viewerId,visible,tabVisible,expired,expiresAt]);
 if(!reputationSquarePublishEnabled()||expired||!viewerId||auth.currentUser?.uid!==viewerId)return null;
 return <div ref={holder}>{visible&&tabVisible&&summary?render(summary):<div className="min-h-16 rounded-2xl border border-slate-800 p-3 text-sm text-slate-400" role="status">{failed?'Publicação indisponível.':'Consultando publicação…'}</div>}</div>;
}

/** Redistribute only the canonical post. This candidate exposes only Praça;
 * do not present other destinations until their access rules are integrated. */
export function ReputationSquareForwardButton({postId,viewerId,friends=[]}:{postId:string;viewerId:string;friends?:Friend[]}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const inFlight=useRef(false);
 const [recipient,setRecipient]=useState('');
 const connected=friends.filter(f=>f.connectionStatus==='accepted'&&f.connectionId&&f.id!==viewerId);
 const selected=connected.find(f=>f.id===recipient);
 async function forward(){
  const user=auth.currentUser;
  if(!reputationSquareForwardEnabled()||!isReputationSquarePost(postId)||!user||user.uid!==viewerId||inFlight.current)return;
  if(recipient&&(!selected||!reputationDirectForwardEnabled()))return;
  inFlight.current=true;setBusy(true);setNotice('');
  try{
   const token=await user.getIdToken(true);if(auth.currentUser!==user)return;
   const response=await fetch('/api/freelance/workspace',{method:'POST',cache:'no-store',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(selected?{action:'forward_reputation_connected',offerId:postId,connectionId:selected.connectionId,recipientId:selected.id,confirmed:true}:{action:'forward_reputation_square',offerId:postId,destination:'square',confirmed:true})});
   const value=await response.json();if(auth.currentUser!==user)return;
   if(response.status===409){setNotice('Encaminhamento indisponível ou já realizado nas últimas 24 horas.');return;}
   if(!response.ok||value?.confirmed!==true)throw Error('FORWARD_UNCONFIRMED');
   setNotice(selected?'Publicação encaminhada ao conectado.':'Publicação encaminhada à Praça.');setOpen(false);
  }catch{if(auth.currentUser===user)setNotice('Não foi possível confirmar o encaminhamento.');}
  finally{inFlight.current=false;setBusy(false);}
 }
 if(!reputationSquareForwardEnabled()||!viewerId||auth.currentUser?.uid!==viewerId)return null;
 return <div className="min-w-0">
  <button type="button" aria-expanded={open} onClick={()=>{setOpen(v=>!v);setNotice('');}} disabled={busy} className="flex min-h-11 w-full min-w-0 items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-2 text-xs font-bold text-slate-300"><Forward className="h-4 w-4 shrink-0"/>Encaminhar</button>
  {open&&<div className="space-y-2 rounded-xl border border-slate-700 p-2 text-sm">
   <p>Escolha o destino. A autoria e as interações originais serão preservadas.</p>
   {reputationDirectForwardEnabled()&&<select aria-label="Destino do encaminhamento" className="w-full rounded-lg bg-slate-950 p-2" value={recipient} disabled={busy} onChange={e=>setRecipient(e.target.value)}><option value="">Praça</option>{connected.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>}
   <button type="button" disabled={busy} onClick={()=>void forward()} className="min-h-11 rounded-lg bg-orange-500 px-3 py-2 font-bold text-slate-950">{busy?'Encaminhando…':'Confirmar'}</button>
   <button type="button" disabled={busy} onClick={()=>setOpen(false)} className="min-h-11 px-2">Cancelar</button>
  </div>}
  {notice&&<p role="status" className="mt-1 text-xs text-slate-400">{notice}</p>}
 </div>;
}

export function ConnectedReputationCard({connectionId,messageId,viewerId}:{connectionId:string;messageId:string;viewerId:string}){
 const [summary,setSummary]=useState<Summary|null>(null),[status,setStatus]=useState<'idle'|'loading'|'ready'|'unavailable'>('idle');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const clear=()=>{pending.current?.abort();pending.current=null;setSummary(null);setStatus('idle');};
  const stop=onAuthStateChanged(auth,u=>{if(u?.uid!==viewerId)clear();});
  const hide=()=>{if(document.hidden)clear();};
  document.addEventListener('visibilitychange',hide);
  return()=>{stop();pending.current?.abort();document.removeEventListener('visibilitychange',hide);};
 },[connectionId,messageId,viewerId]);
 async function load(){
  const user=auth.currentUser;if(!reputationDirectForwardEnabled()||user?.uid!==viewerId||pending.current)return;
  const ctrl=new AbortController();pending.current=ctrl;setSummary(null);setStatus('loading');
  const live=()=>pending.current===ctrl&&!ctrl.signal.aborted&&auth.currentUser===user;
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const res=await fetch('/api/freelance/workspace?view=reputation_connected_card&offerId='+encodeURIComponent(connectionId)+'&cursor='+encodeURIComponent(messageId),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctrl.signal});
   const value=await res.json();if(!live())return;
   if(!res.ok||!validPublicSummaryResponse(value)||!value.experience||!value.reputations){setStatus('unavailable');return;}
   setSummary({experience:value.experience,reputations:value.reputations});setStatus('ready');
  }catch{if(live())setStatus('unavailable');}
  finally{if(pending.current===ctrl)pending.current=null;}
 }
 if(!reputationDirectForwardEnabled()||auth.currentUser?.uid!==viewerId)return null;
 return <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-2 text-slate-200"><button type="button" disabled={status==='loading'} onClick={()=>void load()} className="min-h-11 rounded-lg border border-slate-700 px-2 text-sm font-bold">{status==='loading'?'Consultando…':status==='ready'?'Atualizar indicadores':'Visualizar publicação'}</button>{status==='unavailable'&&<p role="status">Publicação indisponível.</p>}{summary&&status==='ready'&&<ReputationPublicationIndicators summary={summary}/>}</div>;
}
