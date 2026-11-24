import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {auth} from '../utils/firebase';
import {requestReservedTribePilot as request,type ReservedTribeUnlock} from '../utils/reservedTribePilotClient';
import {matchesTribeContactName} from '../utils/tribeContactSearch';
import {ReservedTribeSearchInput} from './ReservedTribeSearchInput';
import type {UserNotification} from '../../shared/userNotifications';

type Relation={id:string;senderId:string;receiverId:string;status:'accepted'|'pending';senderName?:string;receiverName?:string;senderAvatar?:string;receiverAvatar?:string};
type Directory={connections:Relation[];favoriteIds:string[];tribes:{id:string;name:string;memberIds:string[]}[]};
type Session={token:string;expiresAt:number};
type Chat={messages:{id:string;senderId:string;text:string}[]};
const button='min-h-10 rounded-xl border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-40';
const input='min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';

/** Local emulator only, isolated pilot. Does not replace the full legacy
 * mutation flows, does not offer ordinary chat or connection changes yet. */
export function ReservedTribePilotPanel({owner,onBack}:{owner:string;onBack:()=>void}){
 const [ordinary,setOrdinary]=useState<Directory|null>(null),[reserved,setReserved]=useState<Directory|null>(null);
 const [configured,setConfigured]=useState(false),[section,setSection]=useState<'general'|'favorites'|'tribes'|'new'>('general');
 const [term,setTerm]=useState(''),[session,setSession]=useState<Session|null>(null);
 const [setup,setSetup]=useState(false),[code,setCode]=useState(''),[confirmation,setConfirmation]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [target,setTarget]=useState<Relation|null>(null),[chat,setChat]=useState<Chat|null>(null),[draft,setDraft]=useState('');
 const [notices,setNotices]=useState<UserNotification[]|null>(null);
 const current=useRef<Session|null>(null),alive=useRef(false),epoch=useRef(0);
 const pending=useRef<AbortController|null>(null);
 const clearPrivate=useCallback(()=>{
  ++epoch.current;pending.current?.abort();pending.current=null;
  const old=current.current;current.current=null;
  setSession(null);setReserved(null);setTarget(null);setChat(null);setDraft('');setNotices(null);setBusy(false);setError('');setCode('');setConfirmation('');setSetup(false);setTerm('');
  if(old&&auth.currentUser?.uid===owner)void request('lock',{session:old.token}).catch(()=>{});
 },[owner]);
 const stillValid=(s:Session,e:number)=>alive.current&&epoch.current===e&&current.current===s&&s.expiresAt>Date.now()&&auth.currentUser?.uid===owner&&!document.hidden;
 const reload=useCallback(async()=>{
  const e=epoch.current;
  try{
   const [status,dir]=await Promise.all([request<{configured:boolean}>('status'),request<Directory>('directory')]);
   if(alive.current&&epoch.current===e&&auth.currentUser?.uid===owner){setConfigured(status.configured);setOrdinary(dir);}
  }catch{if(alive.current&&epoch.current===e){setOrdinary(null);setError('Não foi possível consultar os conectados.');}}
 },[owner]);
 useEffect(()=>{
  alive.current=true;void reload();
  const hide=()=>{if(document.hidden){clearPrivate();setOrdinary(null);}else void reload();};
  const leave=()=>clearPrivate();
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
  const authStop=auth.onAuthStateChanged(user=>{if(user?.uid!==owner){clearPrivate();setOrdinary(null);}});
  return()=>{alive.current=false;clearPrivate();authStop();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};
 },[owner,clearPrivate,reload]);
 useEffect(()=>{
  if(!session)return;
  const timer=window.setTimeout(()=>{clearPrivate();void reload();},Math.max(0,session.expiresAt-Date.now()));
  return()=>window.clearTimeout(timer);
 },[session,clearPrivate,reload]);
 const unlock=async(secret:string,signal:AbortSignal)=>{
  const e=epoch.current;
  let result:ReservedTribeUnlock;
  try{result=await request<ReservedTribeUnlock>('unlock',{code:secret},signal);}catch{return false;}
  if(!result.ok)return false;
  const next={token:result.token,expiresAt:result.expiresAt};
  if(!alive.current||epoch.current!==e||signal.aborted||document.hidden||auth.currentUser?.uid!==owner){
   if(auth.currentUser?.uid===owner)void request('lock',{session:next.token}).catch(()=>{});
   return false;
  }
  current.current=next;
  try{
   const directory=await request<Directory>('reserved-directory',{session:next.token},signal);
   if(!stillValid(next,e)||signal.aborted){clearPrivate();return false;}
   setReserved(directory);setSession(next);setTerm('');return true;
  }catch{clearPrivate();return false;}
 };
 async function configure(event:FormEvent){
  event.preventDefault();if(busy||code!==confirmation||code.length<8)return;
  const e=epoch.current;setBusy(true);setError('');
  const data={code,confirmation};setCode('');setConfirmation('');
  try{await request('setup',data);if(alive.current&&epoch.current===e){setConfigured(true);setSetup(false);}}
  catch{if(alive.current&&epoch.current===e)setError('Não foi possível configurar o código.');}
  finally{if(alive.current&&epoch.current===e)setBusy(false);}
 }
 const peer=(r:Relation)=>r.senderId===owner?r.receiverId:r.senderId;
 const name=(r:Relation)=>(r.senderId===owner?r.receiverName:r.senderName)||'Kairubido';
 async function privateAction<T>(action:Parameters<typeof request>[0],fields:Record<string,unknown>,apply:(result:T)=>void){
  const s=current.current,e=epoch.current;if(!s||!stillValid(s,e)||busy)return;
  const controller=new AbortController();pending.current=controller;setBusy(true);setError('');
  try{const result=await request<T>(action,{...fields,session:s.token},controller.signal);if(stillValid(s,e))apply(result);}
  catch{if(stillValid(s,e)){clearPrivate();void reload();}}
  finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
 }
 const move=(r:Relation,hide:boolean)=>{
  if(!window.confirm(hide?'Reservar este contato?':'Retirar este contato da Tribo Reservada?'))return;
  void privateAction('membership',{peerId:peer(r),reserved:hide},()=>{clearPrivate();void reload();});
 };
 const openChat=(r:Relation)=>void privateAction<Chat>('chat-read',{connectionId:r.id},data=>{setNotices(null);setTarget(r);setChat(data);setDraft('');});
 const send=(event:FormEvent)=>{event.preventDefault();if(!target||!draft.trim())return;const r=target;void privateAction('chat-send',{connectionId:r.id,messageId:crypto.randomUUID(),text:draft},()=>{setDraft('');setChat(null);});};
 const ordinaryContacts=(ordinary?.connections??[]).filter(r=>r.status==='accepted');
 const normal=ordinaryContacts.filter(r=>matchesTribeContactName(name(r),term)&&(section!=='favorites'||ordinary?.favoriteIds.includes(peer(r))));
 return <div className="space-y-3" data-reserved-tribe-pilot="true">
  <button className={button} onClick={()=>{clearPrivate();onBack();}}>← Voltar ao perfil</button>
  {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  {!session?<><nav className="grid grid-cols-4 gap-1" aria-label="Seções de Conectados">
   {([['general','Geral'],['favorites','Frequentes'],['tribes','Tribos'],['new','Novos']] as const).map(([id,label])=><button key={id} aria-pressed={section===id} className={button+(section===id?' border-orange-500':'')} onClick={()=>setSection(id)}>{label}</button>)}
  </nav>
  <ReservedTribeSearchInput term={term} onSearch={setTerm} unlockAvailable={configured} ownerScope={owner} onUnlock={unlock}/>
  {!ordinary?<button className={button} onClick={()=>void reload()}>Atualizar</button>:section==='tribes'?<div className="space-y-2">
    {ordinary.tribes.map(group=><p key={group.id} className="rounded-xl border border-slate-700 p-3 text-sm">{group.name} · {group.memberIds.length}</p>)}
    {!configured&&!setup&&<button className={button} onClick={()=>setSetup(true)}>Configurar código reservado</button>}
    {setup&&<form className="space-y-2" onSubmit={configure} autoComplete="off">
      <input aria-label="Novo código" type="password" className={input} value={code} onChange={e=>setCode(e.target.value.slice(0,64))} autoComplete="new-password"/>
      <input aria-label="Confirmar código" type="password" className={input} value={confirmation} onChange={e=>setConfirmation(e.target.value.slice(0,64))} autoComplete="new-password"/>
      <p className="text-xs text-slate-400">Após configurar, digite ! seguido do código na pesquisa e confirme.</p>
      <button className={button} disabled={busy||code.length<8||code!==confirmation}>Salvar código</button>
    </form>}
  </div>:section==='new'?<p className="text-sm text-slate-400">Novas conexões ainda não migradas neste piloto.</p>:<div className="grid grid-cols-2 gap-2">{normal.map(r=><div key={r.id} className="rounded-xl border border-slate-700 p-3 text-sm">{name(r)}</div>)}</div>}</>:
  <section className="space-y-3" aria-label="Tribo Reservada">
   <header className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">Tribo Reservada</h3><button className={button} onClick={()=>{clearPrivate();void reload();}}>Trancar</button></header>
   <div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>{setTarget(null);setChat(null);setNotices(null);}}>Contatos</button><button className={button} disabled={busy} onClick={()=>void privateAction<{notifications:UserNotification[]}>('notifications',{},data=>{setTarget(null);setChat(null);setNotices(data.notifications);})}>Avisos</button></div>
   {notices!==null?<div className="space-y-2">{notices.map(n=><div key={n.id} className="rounded-xl border border-slate-700 p-3"><p className="text-sm font-semibold">{n.title}</p><p className="text-sm">{n.body}</p>{!n.readAt&&<button className={button} disabled={busy} onClick={()=>void privateAction('notification-read',{notificationId:n.id},()=>setNotices(old=>old?.map(item=>item.id===n.id?{...item,readAt:new Date().toISOString()}:item)??null))}>Marcar como lida</button>}</div>)}</div>:target?<div className="space-y-2">
    <h4 className="text-sm font-semibold">{name(target)}</h4>
    <button className={button} disabled={busy} onClick={()=>openChat(target)}>Atualizar conversa</button>
    <div className="space-y-2">{chat?.messages.map(m=><p key={m.id} className="rounded-xl bg-slate-900 p-3 text-sm">{m.text}</p>)}</div>
    <form className="flex gap-2" onSubmit={send}><input className={input} aria-label="Mensagem" value={draft} onChange={e=>setDraft(e.target.value.slice(0,4000))}/><button className={button} disabled={busy||!draft.trim()}>Enviar</button></form>
    <button className={button} disabled={busy} onClick={()=>{if(window.confirm('Limpar somente seu histórico?'))void privateAction('chat-clear',{connectionId:target.id},()=>setChat({messages:[]}));}}>Excluir conversa</button>
   </div>:<>
    {(reserved?.connections??[]).map(r=><div key={r.id} className="rounded-xl border border-slate-700 p-3"><p className="text-sm font-semibold">{name(r)}</p><div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>openChat(r)}>Conversar</button><button className={button} disabled={busy} onClick={()=>move(r,false)}>Retirar</button></div></div>)}
    <h4 className="text-sm font-semibold">Adicionar contato</h4>
    {ordinaryContacts.map(r=><button key={r.id} className={button+' block w-full text-left'} disabled={busy} onClick={()=>move(r,true)}>{name(r)}</button>)}
   </>}
  </section>}
 </div>;
}
