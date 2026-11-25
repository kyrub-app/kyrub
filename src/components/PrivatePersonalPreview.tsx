import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../utils/firebase';

type Kind='notes'|'tasks';
type Item={id:string;text:string;done:boolean};
type Action={action:'create';text:string}|{action:'update';id:string;text:string;done:boolean}|{action:'delete';id:string};

export function PrivatePersonalPreview({user}:{user:User}){
 const [kind,setKind]=useState<Kind>('notes');
 const [items,setItems]=useState<Item[]>([]);
 const [draft,setDraft]=useState('');
 const [editing,setEditing]=useState<string|null>(null);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const active=useRef<AbortController|null>(null);
 const pending=useRef(false);
 async function request(controller:AbortController,target:Kind,action?:Action){
  const token=await user.getIdToken(true);
  if(controller.signal.aborted||auth.currentUser?.uid!==user.uid)throw Error('SESSION_CHANGED');
  const response=await fetch('/api/onboarding/personal/'+target,{method:action?'POST':'GET',cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(action?{'Content-Type':'application/json'}:{})},...(action?{body:JSON.stringify(action)}:{})});
  if(!response.ok)throw Error('PERSONAL_UNAVAILABLE');
  const data=await response.json() as {items:Item[]};
  if(controller.signal.aborted||auth.currentUser?.uid!==user.uid||!Array.isArray(data.items))throw Error('PERSONAL_UNAVAILABLE');
  return data.items;
 }
 useEffect(()=>{
  active.current?.abort();const controller=new AbortController();active.current=controller;
  setItems([]);setDraft('');setEditing(null);setReady(false);setNotice('');
  void request(controller,kind).then(result=>{if(!controller.signal.aborted){setItems(result);setReady(true);}}).catch(()=>{if(!controller.signal.aborted)setNotice('Recursos pessoais indisponíveis.');});
  return ()=>controller.abort();
 },[kind,user]);
 const mutate=async(action:Action)=>{
  if(pending.current||!ready)return;
  pending.current=true;setBusy(true);setNotice('');
  active.current?.abort();const controller=new AbortController();active.current=controller;
  try{const result=await request(controller,kind,action);if(!controller.signal.aborted){setItems(result);setDraft('');setEditing(null);}}
  catch{if(!controller.signal.aborted){setItems([]);setDraft('');setEditing(null);setReady(false);setNotice('Não foi possível concluir. Consulte novamente sua situação.');}}
  finally{pending.current=false;setBusy(false);}
 };
 const label=kind==='notes'?'Nota':'Tarefa';
 return <section aria-label="Modo pessoal restrito" className="space-y-3 rounded-xl border border-slate-700 p-3">
  <h2 className="text-base font-semibold">Modo pessoal restrito</h2>
  <p className="text-xs text-slate-400">Apenas seus registros privados. Homologação; sem compartilhamento.</p>
  <div className="flex gap-2">
   <button type="button" aria-pressed={kind==='notes'} disabled={busy} onClick={()=>setKind('notes')}>Notas privadas</button>
   <button type="button" aria-pressed={kind==='tasks'} disabled={busy} onClick={()=>setKind('tasks')}>Tarefas privadas</button>
  </div>
  {notice&&<p role="alert">{notice}</p>}
  {ready&&<>
   <form className="space-y-2" onSubmit={e=>{e.preventDefault();const item=items.find(x=>x.id===editing);void mutate(item?{action:'update',id:item.id,text:draft,done:item.done}:{action:'create',text:draft});}}>
    <label className="block text-sm">{label}<textarea className="block w-full rounded-lg border border-slate-600 bg-slate-900 p-2" maxLength={1000} value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy}/></label>
    <button type="submit" disabled={busy||!draft.trim()}>{editing?'Salvar edição':'Adicionar '+label.toLowerCase()}</button>
    {editing&&<button type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft('');}}>Cancelar edição</button>}
   </form>
   <ul aria-label={kind==='notes'?'Lista de notas':'Lista de tarefas'} className="space-y-2">
    {items.map(item=><li key={item.id} className="rounded-lg border border-slate-700 p-2">
     <p className="whitespace-pre-wrap break-words">{item.text}</p>
     {kind==='tasks'&&<label><input type="checkbox" checked={item.done} disabled={busy} onChange={e=>void mutate({action:'update',id:item.id,text:item.text,done:e.target.checked})}/> Concluída</label>}
     <div className="flex gap-3"><button type="button" disabled={busy} onClick={()=>{setEditing(item.id);setDraft(item.text);}}>Editar</button><button type="button" disabled={busy} onClick={()=>void mutate({action:'delete',id:item.id})}>Excluir</button></div>
    </li>)}
   </ul>
  </>}
 </section>;
}
