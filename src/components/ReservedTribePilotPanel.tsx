import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {auth} from '../utils/firebase';
import {requestReservedTribePilot as request,type ReservedTribeUnlock} from '../utils/reservedTribePilotClient';
import {matchesTribeContactName} from '../utils/tribeContactSearch';
import {ReservedTribeSearchInput} from './ReservedTribeSearchInput';
import {TribePilotChat} from './TribePilotChat';
import {ReservedTribeRecoveryPanel} from './ReservedTribeRecoveryPanel';
import type {UserNotification} from '../../shared/userNotifications';

type Relation={id:string;senderId:string;receiverId:string;status:'accepted'|'pending';senderName?:string;receiverName?:string;senderAvatar?:string;receiverAvatar?:string};
type Directory={connections:Relation[];favoriteIds:string[];tribes:{id:string;name:string;memberIds:string[]}[]};
type Suggestion={id:string;name:string;connectionStatus:'none'|'pending_sent'};
type Session={token:string;expiresAt:number};
const button='min-h-10 rounded-xl border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-40';
const input='min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';

/** Local emulator only, isolated pilot. Does not replace the full legacy
 * external consumers still need migration and browser homologation. */
export function ReservedTribePilotPanel({owner,onBack}:{owner:string;onBack:()=>void}){
 const [ordinary,setOrdinary]=useState<Directory|null>(null),[reserved,setReserved]=useState<Directory|null>(null);
 const [configured,setConfigured]=useState(false),[section,setSection]=useState<'general'|'favorites'|'tribes'|'new'>('general');
 const [term,setTerm]=useState(''),[session,setSession]=useState<Session|null>(null);
 const [setup,setSetup]=useState(false),[code,setCode]=useState(''),[confirmation,setConfirmation]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [target,setTarget]=useState<Relation|null>(null);
 const [notices,setNotices]=useState<UserNotification[]|null>(null);
 const [suggestions,setSuggestions]=useState<Suggestion[]>([]);
 const [groupName,setGroupName]=useState('');
 const [recovering,setRecovering]=useState(false);
 const current=useRef<Session|null>(null),alive=useRef(false),epoch=useRef(0);
 const pending=useRef<AbortController|null>(null);
 const clearPrivate=useCallback(()=>{
  setSuggestions([]);setGroupName('');setRecovering(false);
  ++epoch.current;pending.current?.abort();pending.current=null;
  const old=current.current;current.current=null;
  setSession(null);setReserved(null);setTarget(null);setNotices(null);setBusy(false);setError('');setCode('');setConfirmation('');setSetup(false);setTerm('');
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
  if(busy||target||current.current)return false;
  const e=++epoch.current;setSuggestions([]);
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
 async function ordinaryAction(action:'connection'|'favorite'|'tribe-create'|'tribe-member'|'tribe-delete',fields:Record<string,unknown>){
  if(busy||session||!ordinary||document.hidden)return;
  const e=epoch.current;setBusy(true);setError('');
  try{await request(action,fields);if(alive.current&&epoch.current===e){setSuggestions([]);if(action==='tribe-create')setGroupName('');await reload();}}
  catch{if(alive.current&&epoch.current===e){setOrdinary(null);setSuggestions([]);setError('Não foi possível concluir a operação.');}}
  finally{if(alive.current&&epoch.current===e)setBusy(false);}
 }
 async function loadSuggestions(){
  if(busy||session||!ordinary)return;
  const e=epoch.current;setBusy(true);setSuggestions([]);
  try{const rows=await request<Suggestion[]>('suggestions',{term,limit:30});if(alive.current&&epoch.current===e&&!current.current&&!document.hidden)setSuggestions(rows);}
  catch{if(alive.current&&epoch.current===e)setError('Não foi possível buscar pessoas.');}
  finally{if(alive.current&&epoch.current===e)setBusy(false);}
 }
 const move=(r:Relation,hide:boolean)=>{
  if(!window.confirm(hide?'Reservar este contato?':'Retirar este contato da Tribo Reservada?'))return;
  void privateAction('membership',{peerId:peer(r),reserved:hide},()=>{setOrdinary(null);clearPrivate();void reload();});
 };
 const openChat=(r:Relation)=>{setNotices(null);setTarget(r);};
 const closeChat=useCallback(()=>setTarget(null),[]);
 const chatDenied=useCallback(()=>{setOrdinary(null);clearPrivate();void reload();},[clearPrivate,reload]);
 const ordinaryContacts=(ordinary?.connections??[]).filter(r=>r.status==='accepted');
 const normal=ordinaryContacts.filter(r=>matchesTribeContactName(name(r),term)&&(section!=='favorites'||ordinary?.favoriteIds.includes(peer(r))));
 return <div className="space-y-3" data-reserved-tribe-pilot="true">
  <button className={button} onClick={()=>{clearPrivate();onBack();}}>← Voltar ao perfil</button>
  {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  {recovering&&!session?<ReservedTribeRecoveryPanel owner={owner} onCancel={()=>{clearPrivate();void reload();}} onRecovered={()=>{clearPrivate();setOrdinary(null);void reload();}}/>:!session&&target?<TribePilotChat key={'ordinary:'+target.id} owner={owner} connectionId={target.id} name={name(target)} onClose={closeChat} onDenied={chatDenied}/>:!session?<><nav className="grid grid-cols-4 gap-1" aria-label="Seções de Conectados">
   {([['general','Geral'],['favorites','Frequentes'],['tribes','Tribos'],['new','Novos']] as const).map(([id,label])=><button key={id} aria-pressed={section===id} className={button+(section===id?' border-orange-500':'')} onClick={()=>setSection(id)}>{label}</button>)}
  </nav>
  <ReservedTribeSearchInput term={term} onSearch={value=>{setTerm(value);setSuggestions([]);}} unlockAvailable={configured} ownerScope={owner} onUnlock={unlock}/>
  {!ordinary?<button className={button} onClick={()=>void reload()}>Atualizar</button>:section==='tribes'?<div className="space-y-2">
    <form className="flex gap-2" onSubmit={event=>{event.preventDefault();if(groupName.trim())void ordinaryAction('tribe-create',{groupId:crypto.randomUUID(),name:groupName.trim()});}}>
      <input aria-label="Nome da nova tribo" placeholder="Nome da nova tribo" className={input} value={groupName} maxLength={60} onChange={event=>setGroupName(event.target.value)}/>
      <button className={button} disabled={busy||!groupName.trim()||ordinary.tribes.length>=30}>Criar</button>
    </form>
    {ordinary.tribes.map(group=><section key={group.id} className="rounded-xl border border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{group.name} · {group.memberIds.length}</h4><button type="button" className={button} disabled={busy} onClick={()=>{if(window.confirm('Excluir esta tribo? As conexões serão mantidas.'))void ordinaryAction('tribe-delete',{groupId:group.id});}}>Excluir</button></div>
      {ordinaryContacts.filter(r=>matchesTribeContactName(name(r),term)).map(r=><label key={r.id} className="flex items-center gap-2 text-sm min-h-10"><input type="checkbox" checked={group.memberIds.includes(peer(r))} disabled={busy} onChange={event=>void ordinaryAction('tribe-member',{groupId:group.id,connectionId:r.id,member:event.target.checked})}/>{name(r)}</label>)}
    </section>)}
    {!configured&&!setup&&<button className={button} onClick={()=>setSetup(true)}>Configurar código reservado</button>}
    {configured&&!setup&&<button type="button" className={button} disabled={busy} onClick={()=>{clearPrivate();setOrdinary(null);setRecovering(true);}}>Redefinir código de acesso</button>}
    {setup&&<form className="space-y-2" onSubmit={configure} autoComplete="off">
      <input aria-label="Novo código" type="password" className={input} value={code} onChange={e=>setCode(e.target.value.slice(0,64))} autoComplete="new-password"/>
      <input aria-label="Confirmar código" type="password" className={input} value={confirmation} onChange={e=>setConfirmation(e.target.value.slice(0,64))} autoComplete="new-password"/>
      <p className="text-xs text-slate-400">Após configurar, digite ! seguido do código na pesquisa e confirme.</p>
      <button className={button} disabled={busy||code.length<8||code!==confirmation}>Salvar código</button>
    </form>}
  </div>:section==='new'?<div className="space-y-2">
    <h4 className="text-sm font-semibold">Solicitações</h4>
    {ordinary.connections.filter(r=>r.status==='pending'&&matchesTribeContactName(name(r),term)).map(r=><div key={r.id} className="rounded-xl border border-slate-700 p-3 text-sm">{name(r)}<div className="mt-2 flex gap-2">{r.receiverId===owner&&<button className={button} disabled={busy} onClick={()=>void ordinaryAction('connection',{peerId:peer(r),operation:'accept'})}>Aceitar</button>}<button className={button} disabled={busy} onClick={()=>void ordinaryAction('connection',{peerId:peer(r),operation:'remove'})}>{r.receiverId===owner?'Recusar':'Cancelar'}</button></div></div>)}
    <button className={button} disabled={busy} onClick={()=>void loadSuggestions()}>Buscar sugestões</button>
    {suggestions.filter(item=>item.connectionStatus==='none'&&matchesTribeContactName(item.name,term)).map(item=><div key={item.id} className="rounded-xl border border-slate-700 p-3 text-sm">{item.name}<button className={button+' ml-2'} disabled={busy} onClick={()=>void ordinaryAction('connection',{peerId:item.id,operation:'request'})}>Conectar</button></div>)}
  </div>:<div className="grid grid-cols-2 gap-2">{normal.map(r=><div key={r.id} className="rounded-xl border border-slate-700 p-3 text-sm"><p>{name(r)}</p><div className="mt-2 flex flex-wrap gap-1"><button className={button} disabled={busy} onClick={()=>openChat(r)}>Conversar</button><button className={button} disabled={busy} onClick={()=>void ordinaryAction('favorite',{connectionId:r.id,favorited:!ordinary.favoriteIds.includes(peer(r))})}>{ordinary.favoriteIds.includes(peer(r))?'Desfavoritar':'Favoritar'}</button><button className={button} disabled={busy} onClick={()=>{if(window.confirm('Remover esta conexão?'))void ordinaryAction('connection',{peerId:peer(r),operation:'remove'});}}>Remover</button></div></div>)}</div>}</>:
  <section className="space-y-3" aria-label="Tribo Reservada">
   <header className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">Tribo Reservada</h3><button className={button} onClick={()=>{clearPrivate();void reload();}}>Trancar</button></header>
   <div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>{setTarget(null);setNotices(null);}}>Contatos</button><button className={button} disabled={busy} onClick={()=>void privateAction<{notifications:UserNotification[]}>('notifications',{},data=>{setTarget(null);setNotices(data.notifications);})}>Avisos</button></div>
   {notices!==null?<div className="space-y-2">{notices.map(n=><div key={n.id} className="rounded-xl border border-slate-700 p-3"><p className="text-sm font-semibold">{n.title}</p><p className="text-sm">{n.body}</p>{!n.readAt&&<button className={button} disabled={busy} onClick={()=>void privateAction('notification-read',{notificationId:n.id},()=>setNotices(old=>old?.map(item=>item.id===n.id?{...item,readAt:new Date().toISOString()}:item)??null))}>Marcar como lida</button>}</div>)}</div>:target?<TribePilotChat key={'reserved:'+target.id} owner={owner} connectionId={target.id} name={name(target)} session={session} onClose={closeChat} onDenied={chatDenied}/>:<>
    {(reserved?.connections??[]).map(r=><div key={r.id} className="rounded-xl border border-slate-700 p-3"><p className="text-sm font-semibold">{name(r)}</p><div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>openChat(r)}>Conversar</button><button className={button} disabled={busy} onClick={()=>move(r,false)}>Retirar</button></div></div>)}
    <h4 className="text-sm font-semibold">Adicionar contato</h4>
    {ordinaryContacts.map(r=><button key={r.id} className={button+' block w-full text-left'} disabled={busy} onClick={()=>move(r,true)}>{name(r)}</button>)}
   </>}
  </section>}
 </div>;
}
