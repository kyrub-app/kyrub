import {useRef,useState} from 'react';
import {CID_SOS_CHANNEL_LABELS,type CidEditorAdapter,type CidEditorView,type CidEditorPerson,type CidEditorChannel,type CidEditorDraft} from '../../shared/cidSosConfigEditor';
const channels=Object.keys(CID_SOS_CHANNEL_LABELS) as CidEditorChannel[];
const field='min-h-11 w-full rounded-lg border border-[#34443B] bg-[#1D2924] p-2 text-sm';
const button='min-h-11 rounded-lg border border-[#34443B] p-2 text-sm disabled:opacity-50';
export function KyrubCidSosConfigEditor({adapter,onBusy,onSaved}:{adapter:CidEditorAdapter;onBusy:(busy:boolean)=>void;onSaved:()=>Promise<void>}){
 const [view,setView]=useState<CidEditorView|null>(null),[draft,setDraft]=useState<CidEditorDraft|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const locked=useRef(false);
 const dirty=!!view&&!!draft&&JSON.stringify(view.draft)!==JSON.stringify(draft);
 async function perform(work:()=>Promise<void>){
  if(locked.current)return;locked.current=true;setBusy(true);onBusy(true);setStatus('');
  try{await work();}catch{setStatus('Não foi possível concluir. Confira a autorização ou recarregue a configuração.');}
  finally{locked.current=false;setBusy(false);onBusy(false);}
 }
 async function load(){
  const next=await adapter.read();setView(next);setDraft(structuredClone(next.draft));
 }
 function update(person:CidEditorPerson){
  setDraft(d=>d?{...d,...(d.owner.id===person.id?{owner:person}:{contacts:d.contacts.map(p=>p.id===person.id?person:p)})}:null);
 }
 function changeChannel(person:CidEditorPerson,channel:CidEditorChannel,address:string){
  const entries=person.channels.filter(c=>c.channel!==channel);
  if(address.trim())entries.push({channel,address});
  update({...person,channels:entries});
 }
 const people=draft?[draft.owner,...draft.contacts]:[];
 return <section aria-label="Editor de configuração SOS" className="space-y-3">
  {!draft?<button className={button+' w-full'} disabled={busy} type="button" onClick={()=>void perform(load)}>Editar configuração SOS</button>:<>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> Habilitar alertas SOS</label>
   <p className="text-xs">O titular e cada contato precisam de pelo menos um canal padrão autorizado (e-mail ou WhatsApp). SMS é adicional e opcional. Nenhum canal é autorizado pelo simples cadastro.</p>
   {people.map((p,i)=>{
    const role=i===0?'Titular':'Contato '+i;
    return <fieldset className="space-y-2 rounded-xl border border-[#34443B] p-3" key={p.id} disabled={busy}><legend className="text-sm font-semibold">{role}</legend>
      <label className="block text-sm">Nome <input className={field} aria-label={'Nome — '+role} maxLength={80} value={p.name} onChange={e=>update({...p,name:e.target.value})}/></label>
      {channels.map(channel=>{
       const address=p.channels.find(c=>c.channel===channel)?.address??'';
       const verified=!!view?.verified.some(v=>v.participantId===p.id&&v.channel===channel&&v.address===address);
       return <div key={channel} className="space-y-1"><label className="block text-sm">{CID_SOS_CHANNEL_LABELS[channel]}<input className={field} aria-label={CID_SOS_CHANNEL_LABELS[channel]+' — '+role} type={channel==='email'?'email':'tel'} maxLength={channel==='email'?254:14} placeholder={channel==='email'?'nome@exemplo.com':'+55DDD9XXXXXXXX'} value={address} onChange={e=>changeChannel(p,channel,e.target.value)}/></label>
        {address&&<div className="flex flex-wrap items-center gap-2"><span className="text-xs">{verified?'Verificado e autorizado':'Aguardando autorização'}</span>{!verified&&<button className={button} type="button" disabled={dirty||busy} onClick={()=>void perform(async()=>{await adapter.requestConsent(p.id,channel);setStatus('Solicitação preparada em homologação. A confirmação depende do destinatário.');})}>Solicitar autorização — {CID_SOS_CHANNEL_LABELS[channel]} — {role}</button>}</div>}
       </div>;
      })}
      {i>0&&<button type="button" className={button} onClick={()=>setDraft(d=>d?{...d,contacts:d.contacts.filter(x=>x.id!==p.id)}:null)}>Remover {role.toLowerCase()}</button>}
    </fieldset>;
   })}
   <button type="button" className={button+' w-full'} disabled={busy||draft.contacts.length>=3} onClick={()=>setDraft(d=>d?{...d,contacts:[...d.contacts,{id:crypto.randomUUID(),name:'',channels:[]}]}:null)}>Adicionar contato ({draft.contacts.length}/3)</button>
   <button type="button" className={button+' w-full bg-[#F47825] text-[#121A17] font-semibold'} disabled={busy||!dirty||people.some(p=>!p.name.trim())} onClick={()=>void perform(async()=>{await adapter.save(structuredClone(draft));await load();await onSaved();setStatus('Configuração salva. Canais novos aguardam autorização.');})}>Salvar com passkey</button>
   <button type="button" className={button+' w-full'} disabled={busy} onClick={()=>void perform(load)}>Recarregar e descartar alterações não salvas</button>
   <button type="button" className={button+' w-full'} disabled={busy} onClick={()=>{setView(null);setDraft(null);setStatus('');}}>Fechar editor</button>
  </>}
  {status&&<p role="status" className="text-xs">{status}</p>}
 </section>;
}
