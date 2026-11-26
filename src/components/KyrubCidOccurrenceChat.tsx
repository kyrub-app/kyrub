import {useRef,useState} from 'react';
import {ArrowLeft,EllipsisVertical,Users,MapPin,Download,FileText,ShieldCheck,Flag,CheckCircle,Send} from 'lucide-react';
import {CID_SOS_NOTICE} from '../../shared/cidSosRequest';

export type CidChatAction='participants'|'location'|'download'|'report'|'preserve'|'denounce'|'close';
export type CidChatView={
 id:string;reason:string;role:'owner'|'contact'|'emitter';closed:boolean;participantCount:number;
 messages:readonly {id:string;authorLabel:string;mine:boolean;kind:'message'|'system';body:string;createdAt:number}[];
};
type Props={
 view:CidChatView;
 // The adapter must verify each operation on the server. UI capabilities are not authorization.
 actions:Partial<Record<CidChatAction,()=>Promise<void>>>;
 sendMessage:(input:{id:string;body:string})=>Promise<void>;
 onBack:()=>void;
 simulation?:boolean;
};
const menuItems=[
 {key:'participants',label:'Participantes',Icon:Users},
 {key:'location',label:'Localização compartilhada',Icon:MapPin},
 {key:'download',label:'Baixar conversa',Icon:Download},
 {key:'report',label:'Relatório da ocorrência',Icon:FileText},
 {key:'preserve',label:'Preservar evidências',Icon:ShieldCheck},
 {key:'denounce',label:'Denunciar ocorrência',Icon:Flag},
 {key:'close',label:'Encerrar ocorrência',Icon:CheckCircle}
] as const;
const field='min-h-11 rounded-xl border border-[#34443B] p-3 text-sm';
function timeLabel(value:number){return Number.isFinite(value)?new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(value):'';}
// The parent must remount on occurrence/session changes and supply only an authorized projection.
export function KyrubCidOccurrenceChat({view,actions,sendMessage,onBack,simulation=false}:Props){
 return <ChatPanel key={view.id} view={view} actions={actions} sendMessage={sendMessage} onBack={onBack} simulation={simulation}/>;
}
function ChatPanel({view,actions,sendMessage,onBack,simulation}:Props){
 const [menu,setMenu]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[confirmClose,setConfirmClose]=useState(false);
 const locked=useRef(false),pending=useRef<{id:string;body:string}|null>(null);
 async function send(){
  if(locked.current||view.closed)return;
  const body=draft.trim();
  if(!body||body.length>2000)return;
  locked.current=true;setBusy(true);setStatus('');
  try{
   if(!pending.current||pending.current.body!==body)pending.current={id:crypto.randomUUID(),body};
   await sendMessage(pending.current);pending.current=null;setDraft('');
  }catch{setStatus('Não foi possível enviar a mensagem. Tente novamente.');}
  finally{locked.current=false;setBusy(false);}
 }
 async function run(key:CidChatAction){
  if(locked.current||!actions[key]||(key==='close'&&(view.role!=='owner'||view.closed)))return;
  setMenu(false);setConfirmClose(false);locked.current=true;setBusy(true);setStatus('');
  try{await actions[key]!();}catch{setStatus('Não foi possível concluir a ação. Tente novamente.');}
  finally{locked.current=false;setBusy(false);}
 }
 return <section aria-label="Chat da ocorrência" className="mx-auto max-w-md space-y-3 rounded-xl border border-[#34443B] bg-[#121A17] p-3 text-[#F5F5F3]">
  <header className="flex items-center gap-2">
   <button type="button" aria-label="Voltar" className="min-h-11 min-w-11" onClick={onBack}><ArrowLeft aria-hidden="true"/></button>
   <div className="min-w-0 flex-1"><h2 className="break-words text-base font-bold">Ocorrência · {view.reason}</h2><p className="text-xs text-slate-300">Chat privado · {view.participantCount} participantes</p></div>
   <button type="button" aria-label="Opções da ocorrência" aria-expanded={menu} className="min-h-11 min-w-11" disabled={busy} onClick={()=>setMenu(v=>!v)}><EllipsisVertical aria-hidden="true"/></button>
  </header>
  {menu&&<div aria-label="Ações da ocorrência" className="space-y-1 rounded-xl border border-[#34443B] bg-[#1D2924] p-2">
   {menuItems.filter(m=>m.key!=='close'||view.role==='owner').map(({key,label,Icon})=>{
    const enabled=!!actions[key]&&!(key==='close'&&view.closed);
    return <button key={key} type="button" disabled={!enabled||busy} className="flex min-h-11 w-full items-center gap-2 rounded-lg p-2 text-left text-sm disabled:opacity-50" onClick={()=>{if(key==='close'){setConfirmClose(true);setMenu(false);}else void run(key);}}><Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-[#F47825]"/><span>{label}{!enabled&&<span className="block text-xs text-slate-300">Indisponível</span>}</span></button>;
   })}
  </div>}
  {confirmClose&&<div role="group" aria-label="Confirmar encerramento" className="space-y-2 rounded-lg border border-amber-500/50 p-3"><p className="text-sm">Encerrar a ocorrência? O envio de novas mensagens será desabilitado.</p><button type="button" className={field} onClick={()=>void run('close')}>Confirmar encerramento</button><button type="button" className={field} onClick={()=>setConfirmClose(false)}>Cancelar</button></div>}
  {simulation&&<p className="text-xs text-amber-200">Simulação — nenhum alerta ou mensagem real.</p>}
  <aside className="space-y-1 rounded-lg border border-amber-500/40 p-3 text-xs"><strong>Uso responsável</strong><p>{CID_SOS_NOTICE}</p></aside>
  <div role="log" aria-label="Mensagens da ocorrência" aria-live="polite" className="max-h-[50vh] space-y-3 overflow-y-auto">
   {view.messages.map(m=><div key={m.id} className={'flex '+(m.mine?'justify-end':'justify-start')}><article className={'max-w-[85%] space-y-1 rounded-xl p-3 '+(m.mine?'bg-[#34443B]':'bg-[#26352C]')}><p className="break-words text-xs font-semibold text-[#F47825]">{m.kind==='system'?'Resposta automática':m.authorLabel}</p><p className="whitespace-pre-wrap break-words text-sm">{m.body}</p><p className="text-xs text-slate-300">{timeLabel(m.createdAt)}</p></article></div>)}
  </div>
  {view.closed?<p role="status" className="text-sm">Ocorrência encerrada. O histórico permanece disponível enquanto autorizado.</p>:<form className="flex items-end gap-2" onSubmit={e=>{e.preventDefault();void send();}}>
   <textarea aria-label="Mensagem" placeholder="Escreva uma mensagem..." rows={2} maxLength={2000} className={field+' min-w-0 flex-1 resize-y bg-[#1D2924]'} disabled={busy} value={draft} onChange={e=>setDraft(e.target.value)}/>
   <button type="submit" aria-label="Enviar mensagem" disabled={busy||!draft.trim()} className="min-h-11 min-w-11 rounded-xl bg-[#F47825] p-3 text-[#121A17] disabled:opacity-50"><Send aria-hidden="true" className="h-5 w-5"/></button>
  </form>}
  {status&&<p role="status" className="text-xs">{status}</p>}
 </section>;
}
