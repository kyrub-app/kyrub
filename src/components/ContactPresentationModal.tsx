import {useEffect,useState,useRef} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {auth} from '../utils/firebase';
import {reservedTribePilotClientEnabled,requestReservedTribePilot} from '../utils/reservedTribePilotClient';
import {subscribeSocialPrivacyInvalidation} from '../utils/socialPrivacyInvalidation';
import {changeSocialBlock} from '../hooks/useSocialBlocks';
import {PresentationCard} from './PresentationCard';
import {PresentationRelationship} from './PresentationRelationship';
import {PresentationFooter} from './PresentationFooter';
type Presentation={name:string;occupation:string;bio:string;photoUrl:string;coverUrl:string;backgroundUrl:string;links:{kind:string;name:string;url:string}[]};
type ContactPresentationProps={targetId:string;onClose:()=>void;onChat?:()=>void};
export function ContactPresentationModal(props:ContactPresentationProps){
 if(reservedTribePilotClientEnabled())return <PilotContactPresentationModal key={props.targetId} {...props}/>;
 return <LegacyContactPresentationModal {...props}/>;
}
function PilotContactPresentationModal({targetId,onClose}:ContactPresentationProps){
 const [presentation,setPresentation]=useState<Presentation|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const close=useRef(onClose);close.current=onClose;
 const user=useRef(auth.currentUser).current;
 const alive=useRef(false);
 const write=useRef<AbortController|null>(null);
 useEffect(()=>{
  alive.current=true;
  let read:AbortController|null=null,stopped=false;
  const terminate=()=>{
   if(stopped)return;stopped=true;read?.abort();write.current?.abort();
   setPresentation(null);close.current();
  };
  const valid=()=>!stopped&&auth.currentUser===user&&!!user&&!document.hidden&&navigator.onLine!==false;
  const refresh=async()=>{
   if(!valid()){terminate();return;}
   if(read||write.current)return;
   const ctrl=new AbortController();read=ctrl;
   try{
    const result=await requestReservedTribePilot<{presentation:Presentation|null}>('contact-presentation',{peerId:targetId},ctrl.signal);
    if(!valid()||ctrl.signal.aborted)return;
    if(!result.presentation){terminate();return;}
    setPresentation(result.presentation);setLoading(false);
   }catch{if(!ctrl.signal.aborted)terminate();}
   finally{if(read===ctrl)read=null;}
  };
  const stop=subscribeSocialPrivacyInvalidation(terminate);
  const stopAuth=auth.onAuthStateChanged(next=>{if(next!==user)terminate();});
  const visibility=()=>{if(document.hidden)terminate();};
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('offline',terminate);window.addEventListener('pagehide',terminate);
  const timer=window.setInterval(()=>void refresh(),5000);void refresh();
  return ()=>{alive.current=false;stopped=true;read?.abort();write.current?.abort();stop();stopAuth();window.clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',terminate);window.removeEventListener('pagehide',terminate);};
 },[targetId,user]);
 async function block(){
  if(!presentation||write.current||auth.currentUser!==user||document.hidden||navigator.onLine===false)return;
  if(!window.confirm('Bloquear este contato? A conexão será removida e novas solicitações e mensagens serão impedidas.'))return;
  const ctrl=new AbortController();write.current=ctrl;setBusy(true);setError('');
  try{await requestReservedTribePilot('social-block',{peerId:targetId,blocked:true},ctrl.signal);if(alive.current&&!ctrl.signal.aborted)close.current();}
  catch{if(alive.current&&!ctrl.signal.aborted)setError('Não foi possível confirmar o bloqueio.');}
  finally{if(write.current===ctrl){write.current=null;if(alive.current)setBusy(false);}}
 }
 if(!user||auth.currentUser!==user||document.hidden||navigator.onLine===false)return null;
 return createPortal(<div role="dialog" aria-modal="true" aria-label="Cartão de apresentação" className="fixed inset-0 z-[165] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
  <section className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-[#34443B] bg-[#121A17] p-4 text-white shadow-2xl" onClick={event=>event.stopPropagation()}>
   <header className="flex items-center justify-between gap-3 border-b border-[#34443B] pb-3"><h2 className="text-lg font-bold">Cartão de apresentação</h2><button type="button" onClick={onClose} aria-label="Fechar apresentação" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#34443B]"><X className="h-5 w-5"/></button></header>
   {loading?<p role="status" className="py-5 text-sm">Consultando apresentação…</p>:presentation&&<>
    <PresentationCard {...presentation}><p className="text-xs text-slate-400">Somente informações e conteúdos públicos são exibidos aqui.</p><PresentationRelationship source="contact" id={targetId}/></PresentationCard>
    <button type="button" disabled={busy} className="mt-3 min-h-11 text-sm text-rose-300 underline" onClick={()=>void block()}>Bloquear contato</button>
    {error&&<p role="alert" className="text-xs text-rose-300">{error}</p>}
    <div className="mt-3"><PresentationFooter mode="full"/></div>
   </>}
  </section>
 </div>,document.body);
}
function LegacyContactPresentationModal({targetId,onClose,onChat}:ContactPresentationProps){
 const [state,setState]=useState<{id:string;presentation:Presentation|null;status:'loading'|'ready'|'error'}>({id:'',presentation:null,status:'loading'});
 const [retry,setRetry]=useState(0);
 const [blocking,setBlocking]=useState(false),[blockError,setBlockError]=useState('');
 async function block(){
  if(blocking||!window.confirm('Bloquear este contato? A conexão será removida e novas solicitações e mensagens serão impedidas.'))return;
  setBlocking(true);setBlockError('');
  try{await changeSocialBlock(targetId,true);onClose();}catch{setBlockError('Não foi possível confirmar o bloqueio. Tente novamente.');}finally{setBlocking(false);}
 }
 useEffect(()=>{
  const controller=new AbortController();
  setState({id:targetId,presentation:null,status:'loading'});
  const user=auth.currentUser;
  if(!user){setState({id:targetId,presentation:null,status:'error'});return;}
  void user.getIdToken().then(token=>fetch('/api/health?transport=manage-public-visit-card&view=contact-presentation&id='+encodeURIComponent(targetId),{
   cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token}
  })).then(async res=>{
   if(!res.ok)throw Error('PRESENTATION_UNAVAILABLE');
   const result=await res.json() as {presentation:Presentation|null};
   if(!controller.signal.aborted&&auth.currentUser?.uid===user.uid)setState({id:targetId,presentation:result.presentation,status:'ready'});
  }).catch(()=>{if(!controller.signal.aborted)setState({id:targetId,presentation:null,status:'error'});});
  return()=>controller.abort();
 },[targetId,retry]);
 const presentation=state.id===targetId&&state.status==='ready'?state.presentation:null;
 return createPortal(<div id="public-user-profile-modal" role="dialog" aria-modal="true" aria-label="Cartão de apresentação" className="fixed inset-0 z-[165] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
  <section className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-[#34443B] bg-[#121A17] p-4 text-white shadow-2xl" onClick={e=>e.stopPropagation()}>
   <header className="flex items-center justify-between gap-3 border-b border-[#34443B] pb-3">
    <h2 className="text-lg font-bold">Cartão de apresentação</h2>
    <button type="button" onClick={onClose} aria-label="Fechar apresentação" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#34443B]"><X className="h-5 w-5"/></button>
   </header>
   {state.id!==targetId||state.status==='loading'?<p role="status" className="py-5 text-sm text-slate-300">Consultando apresentação…</p>:
   state.status==='error'?<p role="alert" className="py-5 text-sm">Não foi possível consultar a apresentação. <button type="button" onClick={()=>setRetry(v=>v+1)} className="underline">Tentar novamente</button></p>:
   !presentation?<p className="py-5 text-sm text-slate-300">A apresentação deste Kairubido não está pública.</p>:<PresentationCard {...presentation}>
    <p className="text-xs text-slate-400">Somente informações e conteúdos públicos são exibidos aqui.</p>
    <PresentationRelationship source="contact" id={targetId} onChat={onChat}/>
   </PresentationCard>}
   {auth.currentUser&&auth.currentUser.uid!==targetId&&<div className="mt-3"><button type="button" disabled={blocking} className="min-h-11 text-sm text-rose-300 underline" onClick={()=>void block()}>Bloquear contato</button>{blockError&&<p role="alert" className="text-xs text-rose-300">{blockError}</p>}</div>}
   {presentation&&<div className="mt-3"><PresentationFooter mode="full"/></div>}

  </section>
 </div>,document.body);
}
