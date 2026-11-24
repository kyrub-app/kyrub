import {useEffect,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {ContactRound,MessagesSquare,Store,Users} from 'lucide-react';
import {auth} from '../utils/firebase';

type Mode='checking'|'guest'|'tag_only'|'full'|'unclassified'|'unavailable';
/** Read actual membership from the existing authenticated service, not from sign-in alone. */
export function usePresentationMembership():Mode{
 const [mode,setMode]=useState<Mode>('checking');
 useEffect(()=>{
  let controller:AbortController|null=null;
  const unsubscribe=onAuthStateChanged(auth,user=>{
   controller?.abort();
   const ctrl=new AbortController();controller=ctrl;
   if(!user){setMode('guest');return;}
   setMode('checking');
   void user.getIdToken().then(token=>fetch('/api/health?transport=manage-kyrub-tag&view=identity',{
    signal:ctrl.signal,cache:'no-store',headers:{Authorization:'Bearer '+token}
   })).then(async response=>{
    if(!response.ok)throw Error('IDENTITY_UNAVAILABLE');
    const value=await response.json() as {mode?:string};
    if(!ctrl.signal.aborted&&auth.currentUser?.uid===user.uid)setMode(value.mode==='full'||value.mode==='tag_only'||value.mode==='unclassified'?value.mode:'unavailable');
   }).catch(()=>{if(!ctrl.signal.aborted)setMode('unavailable');});
  });
  return()=>{controller?.abort();unsubscribe();};
 },[]);
 return mode;
}
export function PresentationFooter({context='visitor',mode,onJoin,busy=false}:{context?:'visitor'|'owner';mode:Mode;onJoin?:()=>void;busy?:boolean}){
 if(mode==='checking'||mode==='unavailable')return null;
 if(context==='owner'&&mode!=='tag_only')return null;
 const member=mode==='full';
 return <footer aria-label="Conheça o ecossistema Kyrub" className="space-y-3 rounded-xl border border-[#34443B] bg-[#121A17] p-4 text-[#F5F5F3]">
  <h2 className="text-center text-lg font-bold text-[#F47825]">{context==='owner'?'Sua Tag é só o começo!':'Uma aproximação. Infinitas possibilidades.'}</h2>
  <p className="text-center text-sm text-slate-200">{member?'Explore as possibilidades do ecossistema Kyrub.':context==='owner'?'Torne-se Kairubido gratuitamente e amplie sua apresentação.':'Torne-se Kairubido gratuitamente e crie sua própria apresentação.'}</p>
  {!member&&<div className="space-y-2 text-sm text-slate-200">
   {context==='visitor'&&<p className="flex items-center gap-2"><ContactRound aria-hidden="true" className="h-5 w-5 shrink-0 text-[#F47825]"/>Crie seu cartão de apresentação digital.</p>}
   <p className="flex items-center gap-2"><Users aria-hidden="true" className="h-5 w-5 shrink-0 text-[#F47825]"/>Conecte-se com pessoas.</p>
   <p className="flex items-center gap-2"><MessagesSquare aria-hidden="true" className="h-5 w-5 shrink-0 text-[#F47825]"/>Participe de comunidades.</p>
   <p className="flex items-center gap-2"><Store aria-hidden="true" className="h-5 w-5 shrink-0 text-[#F47825]"/>Crie e divulgue sua loja.</p>
  </div>}
  {context==='owner'&&<p className="text-xs text-slate-300">Aproveite os dados que você já cadastrou. Não precisa começar do zero.</p>}
  {onJoin&&!member?<button type="button" disabled={busy} onClick={onJoin} className="block min-h-11 w-full rounded-xl border border-[#F47825] px-3 py-3 text-center text-sm font-bold text-[#F47825] disabled:opacity-50">{busy?'Preparando acesso…':'Quero ser Kairubido'}</button>:
   <a href={member||mode==='tag_only'?'/':'/?entry=welcome'} className="block min-h-11 rounded-xl border border-[#F47825] px-3 py-3 text-center text-sm font-bold text-[#F47825]">{member?'Explorar o Kyrub':'Quero ser Kairubido'}</a>}
  <a href="/@kyrub-oficial" className="block text-center text-sm text-slate-300 underline">Conheça nossas Kyrub Tags na Loja Oficial</a>
  <p className="border-t border-[#34443B] pt-3 text-center text-xs text-slate-400">Organize-se. Conecte-se. Kyrub-se.</p>
 </footer>;
}
