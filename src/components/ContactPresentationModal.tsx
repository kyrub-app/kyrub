import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {MessageCircle,Store,Users,X,UserRound,ChevronRight} from 'lucide-react';
import {auth} from '../utils/firebase';
import {buildPublicDestinationPath,parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';
type Presentation={name:string;occupation:string;bio:string;photoUrl:string;coverUrl:string;links:{kind:string;name:string;url:string}[]};
export function ContactPresentationModal({targetId,onClose,onChat}:{targetId:string;onClose:()=>void;onChat?:()=>void}){
 const [state,setState]=useState<{id:string;presentation:Presentation|null;status:'loading'|'ready'|'error'}>({id:'',presentation:null,status:'loading'});
 const [retry,setRetry]=useState(0);
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
   !presentation?<p className="py-5 text-sm text-slate-300">A apresentação deste Kairubido não está pública.</p>:<div className="space-y-4 pt-4">
    {presentation.coverUrl&&<img src={presentation.coverUrl} alt="Capa da apresentação" referrerPolicy="no-referrer" className="h-28 w-full rounded-xl object-cover"/>}
    <div className="flex items-center gap-3">
     {presentation.photoUrl?<img src={presentation.photoUrl} alt="" referrerPolicy="no-referrer" className="h-20 w-20 rounded-full object-cover"/>:<div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#26352D]"><UserRound className="h-9 w-9"/></div>}
     <div className="min-w-0"><h3 className="break-words text-xl font-bold">{presentation.name}</h3>{presentation.occupation&&<p className="text-sm text-[#F47825]">{presentation.occupation}</p>}</div>
    </div>
    {presentation.bio&&<p className="whitespace-pre-wrap break-words text-sm text-slate-200">{presentation.bio}</p>}
    {(['community','store'] as const).map(kind=>{
     const links=presentation.links.filter(link=>link.kind===kind);
     return links.length>0&&<section key={kind} className="space-y-2"><h4 className="font-semibold">{kind==='community'?'Comunidades':'Lojas e vitrines'}</h4>
      {links.map(link=>{const parsed=parsePublicDestinationUrl(link.url);const path=parsed&&parsed.kind===kind?buildPublicDestinationPath(kind,parsed.identifier):null;
       return path&&<a href={path} key={link.url} className="flex min-h-12 items-center gap-3 rounded-xl border border-[#34443B] bg-[#1D2924] p-3 text-sm">{kind==='community'?<Users className="h-5 w-5 shrink-0 text-[#F47825]"/>:<Store className="h-5 w-5 shrink-0 text-[#F47825]"/>}<span className="min-w-0 flex-1 break-words">{link.name}</span><ChevronRight className="h-4 w-4"/></a>;})}
     </section>;
    })}
    <p className="text-xs text-slate-400">Somente informações e conteúdos públicos são exibidos aqui.</p>
   </div>}
   {onChat&&<button type="button" onClick={onChat} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F47825] font-bold text-[#121A17]"><MessageCircle className="h-5 w-5"/>Abrir chat</button>}
  </section>
 </div>,document.body);
}
