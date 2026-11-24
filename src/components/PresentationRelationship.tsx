import {useEffect,useState,useRef} from 'react';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {reservedTribePilotClientEnabled,requestReservedTribePilot} from '../utils/reservedTribePilotClient';
import {subscribeSocialPrivacyInvalidation} from '../utils/socialPrivacyInvalidation';
import {ChatModal} from './modals/ChatModal';
type Source='profile'|'tag'|'contact';
type State='none'|'guest'|'join'|'self'|'tag_only'|'unavailable'|'pending_sent'|'pending_received'|'accepted';
type Peer={id:string;name:string;avatar:string;role:string;connectionId:string;connectionStatus:'accepted'};
type Result={state:State;peer?:Peer};
export async function requestPresentationRelationship(source:Source,id:string,action?:'connect'|'cancel'|'accept'|'decline',signal?:AbortSignal):Promise<Result>{
 if(reservedTribePilotClientEnabled())return requestReservedTribePilot<Result>('presentation-relationship',{source,id,operation:action??null},signal);
 const user=auth.currentUser;
 const token=user?await user.getIdToken():null;
 if(auth.currentUser!==user||signal?.aborted)throw Error('SESSION_CHANGED');
 const response=await fetch('/api/health?transport=presentation-relationship&source='+source+'&id='+encodeURIComponent(id),{
  method:action?'POST':'GET',cache:'no-store',signal,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:action?JSON.stringify({action}):undefined
 });
 if(!response.ok)throw Error('RELATIONSHIP_UNAVAILABLE');
 const result=await response.json() as Result;
 if(auth.currentUser!==user||signal?.aborted)throw Error('SESSION_CHANGED');
 return result;
}
function locallyBlocked(uid:string,id:string){
 if(reservedTribePilotClientEnabled())return false;
 try{return (JSON.parse(localStorage.getItem('kyrub_blocked_users_'+uid)??'[]') as string[]).includes(id);}catch{return false;}
}
type RelationshipProps={source:Source;id:string;onChat?:()=>void};
export function PresentationRelationship(props:RelationshipProps){
 if(reservedTribePilotClientEnabled())return <PilotPresentationRelationship key={props.source+':'+props.id} {...props}/>;
 return <LegacyPresentationRelationship key={props.source+':'+props.id} {...props}/>;
}
/** A protected presentation never uses legacy browser storage or the
 * production transport. Auth changes remount the scoped relationship UI. */
function PilotPresentationRelationship(props:RelationshipProps){
 const [user,setUser]=useState<User|null>(auth.currentUser);
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 if(!user||auth.currentUser!==user)return null;
 return <PilotRelationshipSession key={user.uid} {...props} user={user}/>;
}
function PilotRelationshipSession({source,id,user}:RelationshipProps&{user:User}){
 const [result,setResult]=useState<Result|null>(null);
 const [peer,setPeer]=useState<Peer|null>(null);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const alive=useRef(false),sequence=useRef(0),reading=useRef<AbortController|null>(null),writing=useRef<AbortController|null>(null);
 const refreshRef=useRef<()=>void>(()=>{});
 useEffect(()=>{
  alive.current=true;
  const current=()=>alive.current&&auth.currentUser===user&&!document.hidden&&navigator.onLine!==false;
  const clear=()=>{
   sequence.current++;reading.current?.abort();reading.current=null;
   setResult(null);setPeer(null);setMessage('');setNotice('');
  };
  const refresh=()=>{
   if(!current()){clear();return;}
   reading.current?.abort();
   const controller=new AbortController();reading.current=controller;
   const generation=++sequence.current;
   void requestPresentationRelationship(source,id,undefined,controller.signal).then(value=>{
    if(!current()||controller.signal.aborted||generation!==sequence.current)return;
    setResult(value);
    setPeer(old=>value.state==='accepted'&&value.peer&&old?.connectionId===value.peer.connectionId&&old.id===value.peer.id?old:null);
    if(value.state!=='accepted')setMessage('');
   }).catch(()=>{if(!controller.signal.aborted&&generation===sequence.current)clear();})
    .finally(()=>{if(reading.current===controller)reading.current=null;});
  };
  refreshRef.current=refresh;
  const invalidate=()=>{clear();refresh();};
  const suspend=()=>{writing.current?.abort();clear();};
  const visibility=()=>{if(document.hidden)suspend();else invalidate();};
  const stop=subscribeSocialPrivacyInvalidation(invalidate);
  const stopAuth=onAuthStateChanged(auth,next=>{if(next!==user)suspend();});
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('offline',suspend);window.addEventListener('online',invalidate);window.addEventListener('pagehide',suspend);
  const timer=window.setInterval(()=>{if(!writing.current&&!reading.current)refresh();},5000);
  refresh();
  return ()=>{
   alive.current=false;sequence.current++;reading.current?.abort();writing.current?.abort();refreshRef.current=()=>{};
   stop();stopAuth();window.clearInterval(timer);document.removeEventListener('visibilitychange',visibility);
   window.removeEventListener('offline',suspend);window.removeEventListener('online',invalidate);window.removeEventListener('pagehide',suspend);
  };
 },[source,id,user]);
 async function act(operation:'connect'|'cancel'|'accept'|'decline'){
  if(writing.current||!result||auth.currentUser!==user||document.hidden||navigator.onLine===false)return;
  const controller=new AbortController();writing.current=controller;setBusy(true);setNotice('');
  reading.current?.abort();sequence.current++;setResult(null);setPeer(null);setMessage('');
  try{await requestPresentationRelationship(source,id,operation,controller.signal);}
  catch{if(alive.current&&!controller.signal.aborted&&auth.currentUser===user)setNotice('Não foi possível concluir. Atualize e tente novamente.');}
  finally{
   if(writing.current===controller){writing.current=null;if(alive.current&&auth.currentUser===user){setBusy(false);refreshRef.current();}}
  }
 }
 if(auth.currentUser!==user||document.hidden||navigator.onLine===false)return null;
 if(!result||result.state==='unavailable'||result.state==='self')return notice?<p role="status" className="text-xs text-slate-300">{notice}</p>:null;
 const btn='min-h-11 w-full rounded-xl border border-[#F47825] px-3 py-2 text-center text-sm font-bold text-[#F47825] disabled:opacity-50';
 return <div className="space-y-2">
  {result.state==='tag_only'&&<p className="text-sm text-slate-300">Este titular ainda não faz parte da rede Kyrub.</p>}
  {result.state==='join'&&<a className={btn+' block'} href="/">Torne-se Kairubido para conectar</a>}
  {result.state==='none'&&<button type="button" disabled={busy} className={btn} onClick={()=>void act('connect')}>Conectar</button>}
  {result.state==='pending_sent'&&<><p className="text-center text-sm text-slate-300">Solicitação enviada</p><button type="button" disabled={busy} className={btn} onClick={()=>void act('cancel')}>Cancelar solicitação</button></>}
  {result.state==='pending_received'&&<div className="grid grid-cols-2 gap-2"><button type="button" disabled={busy} className={btn} onClick={()=>void act('accept')}>Aceitar conexão</button><button type="button" disabled={busy} className={btn} onClick={()=>void act('decline')}>Recusar</button></div>}
  {result.state==='accepted'&&result.peer&&<button type="button" className={btn} onClick={()=>{setPeer(result.peer!);setMessage('');}}>Abrir chat</button>}
  {notice&&<p role="status" className="text-xs text-slate-300">{notice}</p>}
  {peer&&<ChatModal isOpen={true} onClose={()=>setPeer(null)} selectedChatUser={peer} setSelectedChatUser={setPeer} chatMessageText={message} setChatMessageText={setMessage}/>}
 </div>;
}
function LegacyPresentationRelationship({source,id,onChat}:RelationshipProps){
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
    if(!next.signal.aborted&&auth.currentUser?.uid===uid){setResult(value);if(value.state!=='accepted'){setPeer(null);setMessage('');}}
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
