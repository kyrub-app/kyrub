import {useEffect,useRef,useState,type FormEvent} from 'react';
import {auth} from '../utils/firebase';
import {subscribeSocialPrivacyInvalidation} from '../utils/socialPrivacyInvalidation';
import {buildCommunityPostInternalLink} from '../utils/communityPostForwarding';
import {OPEN_COMMUNITY_FROM_SQUARE_EVENT} from '../utils/communitySquareFeed';
import type {CloudCommunityPost} from '../utils/communityCloud';
import {requestReservedTribePilot as request} from '../utils/reservedTribePilotClient';

type Session={token:string;expiresAt:number};
type Chat={messages:{id:string;senderId:string;receiverId:string;text:string}[]};
type Props={owner:string;connectionId:string;name:string;session?:Session;forwardingPost?:CloudCommunityPost|null;initialText?:string;onMessageSent?:(text:string)=>void;onClose:()=>void;onDenied:()=>void};
const POLL_MS=5000;
const button='min-h-10 rounded-xl border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-40';

/** Shared, ephemeral chat; never read directly from Firestore. */
export function TribePilotChat({owner,connectionId,name,session,forwardingPost,initialText,onMessageSent,onClose,onDenied}:Props){
 const [chat,setChat]=useState<Chat|null>(null),[draft,setDraft]=useState(initialText??''),[busy,setBusy]=useState(false);
 const [sendError,setSendError]=useState('');
 const controller=useRef<AbortController|null>(null),active=useRef(false),sequence=useRef(0),inFlight=useRef(false);
 const refreshRef=useRef<()=>void>(()=>{});
 const closeRef=useRef(onClose),deniedRef=useRef(onDenied);
 closeRef.current=onClose;deniedRef.current=onDenied;
 useEffect(()=>{
  active.current=true;setChat(null);setDraft(initialText??'');setBusy(false);setSendError('');
  let timer:number|undefined;
  const usable=()=>active.current&&auth.currentUser?.uid===owner&&!document.hidden&&navigator.onLine!==false&&(!session||session.expiresAt>Date.now());
  const invalidate=()=>{++sequence.current;controller.current?.abort();controller.current=null;inFlight.current=false;setChat(null);setDraft('');setBusy(false);};
  const fail=()=>{invalidate();if(active.current)deniedRef.current();};
  const schedule=()=>{if(timer!==undefined)window.clearTimeout(timer);if(usable())timer=window.setTimeout(()=>void refresh(),POLL_MS);};
  async function refresh(){
   if(!usable()){fail();return;}
   if(inFlight.current){schedule();return;}
   const id=++sequence.current,abort=new AbortController();
   controller.current=abort;inFlight.current=true;
   try{
    const result=await request<Chat>(session?'chat-read':'ordinary-chat-read',{connectionId,...(session?{session:session.token}:{})},abort.signal);
    if(usable()&&sequence.current===id&&!abort.signal.aborted)setChat(result);
   }catch{if(active.current&&sequence.current===id&&!abort.signal.aborted)fail();}
   finally{if(sequence.current===id){controller.current=null;inFlight.current=false;schedule();}}
  }
  refreshRef.current=()=>{if(timer!==undefined)window.clearTimeout(timer);void refresh();};
  const hide=()=>{if(document.hidden){invalidate();closeRef.current();}};
  const pagehide=()=>{invalidate();closeRef.current();};
  const authStop=auth.onAuthStateChanged(user=>{if(user?.uid!==owner){invalidate();closeRef.current();}});
  const stopPrivacy=subscribeSocialPrivacyInvalidation(pagehide);
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pagehide);window.addEventListener('offline',pagehide);
  void refresh();
  return()=>{active.current=false;++sequence.current;controller.current?.abort();controller.current=null;inFlight.current=false;if(timer!==undefined)window.clearTimeout(timer);authStop();stopPrivacy();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pagehide);window.removeEventListener('offline',pagehide);};
 },[owner,connectionId,session]);
 async function mutate(kind:'send'|'clear'){
  if(busy||!active.current||!chat||auth.currentUser?.uid!==owner||document.hidden||navigator.onLine===false||(session&&session.expiresAt<=Date.now()))return;
  if(kind==='send'&&!draft.trim())return;
  if(kind==='clear'&&!window.confirm('Excluir o histórico somente da sua visualização?'))return;
  const id=++sequence.current;controller.current?.abort();
  const abort=new AbortController();controller.current=abort;inFlight.current=true;setBusy(true);setSendError('');
  const fields={connectionId,...(session?{session:session.token}:{}),...(kind==='send'?{messageId:crypto.randomUUID(),text:draft.trim()}: {})};
  try{
   const isForward=kind==='send'&&!session&&forwardingPost&&draft.includes(buildCommunityPostInternalLink(forwardingPost));
   if(isForward)await request('ordinary-forward',{...fields,postId:forwardingPost.id,communityId:forwardingPost.communityId},abort.signal);
   else await request(session?(kind==='send'?'chat-send':'chat-clear'):(kind==='send'?'ordinary-chat-send':'ordinary-chat-clear'),fields,abort.signal);
   if(active.current&&sequence.current===id&&auth.currentUser?.uid===owner&&!document.hidden&&(!session||session.expiresAt>Date.now())){
    setDraft('');if(kind==='clear')setChat({messages:[]});else onMessageSent?.(draft);
   }
  }catch(error){if(active.current&&sequence.current===id&&!abort.signal.aborted){
    if(error instanceof Error&&error.message==='TRIBE_FORWARD_DUPLICATE')setSendError('Você já encaminhou esta publicação para esta pessoa nas últimas 24 horas.');
    else{setChat(null);setDraft('');deniedRef.current();}
  }}
  finally{if(active.current&&sequence.current===id){controller.current=null;inFlight.current=false;setBusy(false);refreshRef.current();}}
 }
 function send(event:FormEvent){event.preventDefault();void mutate('send');}
 return <section className="space-y-3" aria-label="Conversa">
  <header className="flex items-center justify-between gap-2"><h4 className="text-base font-semibold">{name}</h4><button type="button" className={button} onClick={onClose}>Voltar</button></header>
  {!chat?<p className="text-sm text-slate-400" role="status">Consultando conversa…</p>:<div className="max-h-80 overflow-y-auto space-y-2" role="log" aria-label="Mensagens">
    {chat.messages.length===0&&<p className="text-sm text-slate-400">Nenhuma mensagem.</p>}
    {chat.messages.map(message=><div key={message.id} className={'flex '+(message.senderId===owner?'justify-end':'justify-start')}><p className={'max-w-[85%] break-words whitespace-pre-wrap rounded-xl px-3 py-2 text-sm '+(message.senderId===owner?'bg-orange-500 text-slate-950':'bg-slate-800 text-white')}>{message.text}{(message.text.match(/https?:\/\/[^\s]+/g)??[]).flatMap(raw=>{try{const url=new URL(raw);const communityId=url.searchParams.get('community')??'',postId=url.searchParams.get('post')??'';if((url.origin!==window.location.origin&&!(url.protocol==='https:'&&['kyrub.com','www.kyrub.com'].includes(url.hostname)))||!(/^[a-zA-Z0-9_-]{1,128}$/.test(communityId))||!(/^[a-zA-Z0-9_-]{1,128}$/.test(postId)))return [];return [<button type="button" key={raw} className="block underline text-sm mt-2" onClick={()=>{onClose();window.dispatchEvent(new CustomEvent(OPEN_COMMUNITY_FROM_SQUARE_EVENT,{detail:{communityId,postId}}));}}>Abrir publicação</button>];}catch{return [];}})}</p></div>)}
  </div>}
  {sendError&&<p role="alert" className="text-sm text-red-300">{sendError}</p>}
  <form className="flex gap-2" onSubmit={send}><input className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white" aria-label="Mensagem" value={draft} maxLength={4000} onChange={event=>setDraft(event.target.value)} autoComplete="off" disabled={busy||!chat}/><button className={button} disabled={busy||!chat||!draft.trim()}>Enviar</button></form>
  <button type="button" className={button} disabled={busy||!chat} onClick={()=>void mutate('clear')}>Excluir conversa</button>
 </section>;
}
