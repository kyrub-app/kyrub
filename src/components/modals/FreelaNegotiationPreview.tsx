import {useEffect,useRef,useState} from 'react';
import {auth} from '../../utils/firebase';
import {listHiringMessages,sendHiringMessage,type HiringApplication,type HiringMessage,type HiringMessageCursor} from '../../utils/freelanceHiringCloud';

export function FreelaNegotiationPreview({application,actor}:{application:HiringApplication;actor:string}){
 const [messages,setMessages]=useState<HiringMessage[]>([]);
 const [draft,setDraft]=useState('');
 const pendingSend=useRef<{id:string;text:string}|null>(null);
 const [retryPending,setRetryPending]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [loaded,setLoaded]=useState(false);
 const [cursor,setCursor]=useState<HiringMessageCursor|null>(null);
 const active=['pending','accepted','completion_requested'].includes(application.status);
 const current=()=>auth.currentUser?.uid===actor;
 useEffect(()=>{
  let cancelled=false;
  void listHiringMessages(application.id).then(page=>{
   if(!cancelled&&current()){setMessages(page.items);setCursor(page.nextCursor);setLoaded(true);}
  }).catch(()=>{if(!cancelled&&current())setNotice('Não foi possível consultar a negociação.');});
  return ()=>{cancelled=true;};
 },[application.id,actor]);
 const refresh=async()=>{
  const page=await listHiringMessages(application.id);
  if(current()){setMessages(page.items);setCursor(page.nextCursor);setLoaded(true);}
 };
 const loadOlder=async()=>{
  if(busy||!cursor||!current())return;
  setBusy(true);setNotice('');
  try{
   const page=await listHiringMessages(application.id,cursor);
   if(current()){
    setMessages(existing=>{const ids=new Set(existing.map(m=>m.id));return [...page.items.filter(m=>!ids.has(m.id)),...existing];});
    setCursor(page.nextCursor);
   }
  }catch{if(current())setNotice('Não foi possível carregar mensagens anteriores.');}
  finally{setBusy(false);}
 };
 const send=async()=>{
  if(busy||(!active&&!pendingSend.current)||!current()||!draft.trim())return;
  const attempt=pendingSend.current??{id:crypto.randomUUID(),text:draft.trim()};
  pendingSend.current=attempt;
  setRetryPending(true);setBusy(true);setNotice('');
  try{
   await sendHiringMessage(application.id,attempt.text,attempt.id);
   if(current()){pendingSend.current=null;setRetryPending(false);setDraft('');setNotice('Mensagem registrada.');}
  }catch{
   if(current())setNotice('Envio não confirmado. Tente confirmar novamente a mesma mensagem; ela não será duplicada.');
   setBusy(false);return;
  }
  try{await refresh();}catch{if(current())setNotice('Mensagem registrada. Atualização do histórico indisponível.');}
  finally{setBusy(false);}
 };
 return <section className="space-y-3 border border-slate-700 rounded-xl p-3">
   <h5 className="font-bold">Negociação privada</h5>
   <p className="text-xs text-slate-300">Mensagens enviadas não podem ser editadas nem apagadas. Envie uma nova mensagem para corrigir uma informação.</p>
   <p className="text-xs text-slate-300">{active?'Conversa vinculada à candidatura.':'Negociação encerrada. Histórico somente para consulta.'} {loaded?`${messages.length} mensagens carregadas.`:'Carregando histórico…'}</p>
   {cursor&&<button type="button" disabled={busy} onClick={()=>void loadOlder()} className="border border-slate-600 rounded-lg p-2">Carregar mensagens anteriores</button>}
   <div className="space-y-2 max-h-64 overflow-y-auto" aria-label="Mensagens da negociação">
    {loaded&&messages.length===0&&<p className="text-slate-400">Nenhuma mensagem registrada.</p>}
    {messages.map(m=><article key={m.id} className="rounded-lg border border-slate-700 p-2">
     <div className="text-xs text-slate-400">{m.senderId===actor?'Você':'Outra parte'} · {new Date(m.createdAtMs).toLocaleString('pt-BR')}</div>
     <p className="whitespace-pre-wrap break-words">{m.text}</p>
    </article>)}
   </div>
   {(active||retryPending)&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void send();}}>
    <label className="block">Mensagem<textarea className="block w-full bg-slate-950 rounded-lg p-2" maxLength={4000} required value={draft} disabled={busy||retryPending} onChange={e=>setDraft(e.target.value)}/></label>
    <button type="submit" disabled={busy||!draft.trim()} className="bg-teal-500 text-slate-950 rounded-lg p-2 font-bold">{retryPending?'Confirmar novamente':'Enviar mensagem'}</button>
   </form>}
   <button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{if(busy)return;setBusy(true);setNotice('');void refresh().catch(()=>{if(current())setNotice('Não foi possível atualizar a negociação.');}).finally(()=>setBusy(false));}}>Atualizar mensagens recentes</button>
   <p role="status">{notice}</p>
 </section>;
}
