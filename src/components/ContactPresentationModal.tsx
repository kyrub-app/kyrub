import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {auth} from '../utils/firebase';
import {changeSocialBlock} from '../hooks/useSocialBlocks';
import {PresentationCard} from './PresentationCard';
import {PresentationRelationship} from './PresentationRelationship';
import {PresentationFooter} from './PresentationFooter';
type Presentation={name:string;occupation:string;bio:string;photoUrl:string;coverUrl:string;backgroundUrl:string;links:{kind:string;name:string;url:string}[]};
export function ContactPresentationModal({targetId,onClose,onChat}:{targetId:string;onClose:()=>void;onChat?:()=>void}){
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
