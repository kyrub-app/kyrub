import {useEffect,useState,useRef} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {ChatModal} from './modals/ChatModal';
type Source='profile'|'tag'|'contact';
type State='none'|'guest'|'join'|'self'|'tag_only'|'unavailable'|'pending_sent'|'pending_received'|'accepted';
type Peer={id:string;name:string;avatar:string;role:string;connectionId:string;connectionStatus:'accepted'};
type Result={state:State;peer?:Peer};
export async function requestPresentationRelationship(source:Source,id:string,action?:'connect'|'cancel'|'accept'|'decline',signal?:AbortSignal):Promise<Result>{
 const user=auth.currentUser;
 const token=user?await user.getIdToken():null;
 if(auth.currentUser?.uid!==user?.uid)throw Error('SESSION_CHANGED');
 const response=await fetch('/api/health?transport=presentation-relationship&source='+source+'&id='+encodeURIComponent(id),{
  method:action?'POST':'GET',cache:'no-store',signal,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:action?JSON.stringify({action}):undefined
 });
 if(!response.ok)throw Error('RELATIONSHIP_UNAVAILABLE');
 return response.json();
}
function locallyBlocked(uid:string,id:string){
 try{return (JSON.parse(localStorage.getItem('kyrub_blocked_users_'+uid)??'[]') as string[]).includes(id);}catch{return false;}
}
export function PresentationRelationship({source,id,onChat}:{source:Source;id:string;onChat?:()=>void}){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[peer,setPeer]=useState<Peer|null>(null),[message,setMessage]=useState('');
 const [retry,setRetry]=useState(0);
 const lock=useRef(false);
 useEffect(()=>{
  let ctrl:AbortController|null=null;
  const refresh=()=>{
   ctrl?.abort();const next=new AbortController();ctrl=next;
   const uid=auth.currentUser?.uid;
   if(source==='contact'&&uid&&locallyBlocked(uid,id)){setResult({state:'unavailable'});return;}
   void requestPresentationRelationship(source,id,undefined,next.signal).then(value=>{
    if(!next.signal.aborted&&auth.currentUser?.uid===uid)setResult(value);
   }).catch(()=>{if(!next.signal.aborted)setResult(null);});
  };
  setResult(null);setPeer(null);setNotice('');
  const unsub=onAuthStateChanged(auth,()=>{setResult(null);setPeer(null);refresh();});
  const timer=window.setInterval(()=>{if(!lock.current)refresh();},10000);
  return()=>{ctrl?.abort();unsub();window.clearInterval(timer);};
 },[source,id,retry]);
 async function act(action:'connect'|'cancel'|'accept'|'decline'){
  if(lock.current)return;lock.current=true;setBusy(true);setNotice('');
  const uid=auth.currentUser?.uid;
  try{const next=await requestPresentationRelationship(source,id,action);if(auth.currentUser?.uid===uid)setResult(next);}
  catch{setNotice('Não foi possível concluir. Confira a solicitação e tente novamente.');setRetry(v=>v+1);}
  finally{lock.current=false;setBusy(false);}
 }
 if(!result||result.state==='unavailable'||result.state==='self')return null;
 const btn='min-h-11 w-full rounded-xl border border-[#F47825] px-3 py-2 text-center text-sm font-bold text-[#F47825] disabled:opacity-50';
 return <div className="space-y-2">
  {result.state==='tag_only'&&<p className="text-sm text-slate-300">Este titular ainda não faz parte da rede Kyrub.</p>}
  {(result.state==='guest'||result.state==='join')&&<a className={btn+' block'} href={result.state==='join'?'/':'/?entry=welcome'}>{result.state==='join'?'Torne-se Kairubido para conectar':'Entrar para conectar'}</a>}
  {result.state==='none'&&<button type="button" disabled={busy} className={btn+' bg-[#F47825] text-[#121A17]'} onClick={()=>void act('connect')}>Conectar</button>}
  {result.state==='pending_sent'&&<><p className="text-center text-sm text-slate-300">Solicitação enviada</p><button type="button" disabled={busy} className={btn} onClick={()=>void act('cancel')}>Cancelar solicitação</button></>}
  {result.state==='pending_received'&&<div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className={btn+' bg-[#F47825] text-[#121A17]'} onClick={()=>void act('accept')}>Aceitar conexão</button><button type="button" disabled={busy} className={btn} onClick={()=>void act('decline')}>Recusar</button></div>}
  {result.state==='accepted'&&result.peer&&<button type="button" className={btn+' bg-[#F47825] text-[#121A17]'} onClick={()=>{if(onChat)onChat();else{setPeer(result.peer!);setMessage('');}}}>Abrir chat</button>}
  {notice&&<p role="status" className="text-xs text-slate-300">{notice}</p>}
  {peer&&<ChatModal isOpen={true} onClose={()=>setPeer(null)} selectedChatUser={peer} setSelectedChatUser={setPeer} chatMessageText={message} setChatMessageText={setMessage}/>}
 </div>;
}
