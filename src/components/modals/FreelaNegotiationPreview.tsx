import {useEffect,useState} from 'react';
import {auth} from '../../utils/firebase';
import {listHiringMessages,sendHiringMessage,type HiringApplication,type HiringMessage} from '../../utils/freelanceHiringCloud';

export function FreelaNegotiationPreview({application,actor}:{application:HiringApplication;actor:string}){
 const [messages,setMessages]=useState<HiringMessage[]>([]);
 const [draft,setDraft]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [loaded,setLoaded]=useState(false);
 const active=['pending','accepted','completion_requested'].includes(application.status);
 const current=()=>auth.currentUser?.uid===actor;
 useEffect(()=>{
  let cancelled=false;
  void listHiringMessages(application.id).then(items=>{
   if(!cancelled&&current()){setMessages(items);setLoaded(true);}
  }).catch(()=>{if(!cancelled&&current())setNotice('Não foi possível consultar a negociação.');});
  return ()=>{cancelled=true;};
 },[application.id,actor]);
 const refresh=async()=>{
  const items=await listHiringMessages(application.id);
  if(current()){setMessages(items);setLoaded(true);}
 };
 const send=async()=>{
  if(busy||!active||!current()||!draft.trim())return;
  setBusy(true);setNotice('');
  try{
   await sendHiringMessage(application.id,draft);
   if(current()){setDraft('');setNotice('Mensagem registrada.');}
  }catch{
   if(current())setNotice('Envio não confirmado. Atualize a conversa antes de tentar novamente.');
   setBusy(false);return;
  }
  try{await refresh();}catch{if(current())setNotice('Mensagem registrada. Atualização do histórico indisponível.');}
  finally{setBusy(false);}
 };
 return <section className="space-y-3 border border-slate-700 rounded-xl p-3">
   <h5 className="font-bold">Negociação privada</h5>
   <p className="text-xs text-slate-300">Mensagens enviadas não podem ser editadas nem apagadas. Envie uma nova mensagem para corrigir uma informação.</p>
   <p className="text-xs text-slate-300">{active?'Conversa vinculada à candidatura.':'Negociação encerrada. Histórico somente para consulta.'} Exibindo até 100 mensagens recentes.</p>
   <div className="space-y-2 max-h-64 overflow-y-auto" aria-label="Mensagens da negociação">
    {loaded&&messages.length===0&&<p className="text-slate-400">Nenhuma mensagem registrada.</p>}
    {messages.map(m=><article key={m.id} className="rounded-lg border border-slate-700 p-2">
     <div className="text-xs text-slate-400">{m.senderId===actor?'Você':'Outra parte'} · {new Date(m.createdAtMs).toLocaleString('pt-BR')}</div>
     <p className="whitespace-pre-wrap break-words">{m.text}</p>
    </article>)}
   </div>
   {active&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void send();}}>
    <label className="block">Mensagem<textarea className="block w-full bg-slate-950 rounded-lg p-2" maxLength={4000} required value={draft} disabled={busy} onChange={e=>setDraft(e.target.value)}/></label>
    <button type="submit" disabled={busy||!draft.trim()} className="bg-teal-500 text-slate-950 rounded-lg p-2 font-bold">Enviar mensagem</button>
   </form>}
   <button type="button" disabled={busy} className="border border-slate-600 rounded-lg p-2" onClick={()=>{setNotice('');void refresh().catch(()=>{if(current())setNotice('Não foi possível atualizar a negociação.');});}}>Atualizar conversa</button>
   <p role="status">{notice}</p>
 </section>;
}
