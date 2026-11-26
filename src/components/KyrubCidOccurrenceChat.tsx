import {useRef,useState} from 'react';
import {ArrowLeft,EllipsisVertical,Users,MapPin,Download,FileText,ShieldCheck,Flag,CheckCircle,Send} from 'lucide-react';
import {CID_SOS_RESOLUTION_LABELS,type CidSosResolution} from '../../shared/cidSosResolution';
import {CID_COMPLAINT_CATEGORIES,type CidComplaintCategory,type CidComplaintInput,type CidComplaintReceipt} from '../../shared/cidOccurrenceComplaint';
import {CID_SOS_NOTICE} from '../../shared/cidSosRequest';

export type CidChatAction='participants'|'location'|'download'|'report'|'preserve'|'denounce'|'close';
export type CidChatView={
 id:string;reason:string;role:'owner'|'contact'|'emitter';closed:boolean;participantCount:number;resolution?:CidSosResolution;
 messages:readonly {id:string;authorLabel:string;mine:boolean;kind:'message'|'system';body:string;createdAt:number}[];
};
type Props={
 view:CidChatView;
 // The adapter must verify each operation on the server. UI capabilities are not authorization.
 actions:Partial<Record<CidChatAction,()=>Promise<void>>>;
 resolveOccurrence?:(reason:CidSosResolution)=>Promise<void>;
 preserveEvidence?:(reason:string)=>Promise<{id:string;status:'pending-review'}>;
 denounceOccurrence?:(input:CidComplaintInput)=>Promise<CidComplaintReceipt>;
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
export function KyrubCidOccurrenceChat({view,actions,resolveOccurrence,preserveEvidence,denounceOccurrence,sendMessage,onBack,simulation=false}:Props){
 return <ChatPanel key={view.id} view={view} actions={actions} resolveOccurrence={resolveOccurrence} preserveEvidence={preserveEvidence} denounceOccurrence={denounceOccurrence} sendMessage={sendMessage} onBack={onBack} simulation={simulation}/>;
}
function ChatPanel({view,actions,resolveOccurrence,preserveEvidence,sendMessage,onBack,simulation}:Props){
 const [menu,setMenu]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[confirmClose,setConfirmClose]=useState(false);
 const [resolution,setResolution]=useState<CidSosResolution|''>('');
 const [preserveOpen,setPreserveOpen]=useState(false),[preserveReason,setPreserveReason]=useState('');
 const [complaintOpen,setComplaintOpen]=useState(false),[category,setCategory]=useState<CidComplaintCategory|''>(''),[complaintReason,setComplaintReason]=useState(''),[complaintConfirmed,setComplaintConfirmed]=useState(false);
 async function submitComplaint(){
  if(locked.current||!denounceOccurrence||!category||!complaintReason.trim()||!complaintConfirmed)return;
  locked.current=true;setBusy(true);setStatus('');
  try{const result=await denounceOccurrence({category,reason:complaintReason.trim(),confirmed:true});if(result.status!=='pending-review')throw Error('CID_COMPLAINT_UNCONFIRMED');setStatus('Denúncia '+result.id+' registrada para análise administrativa.');setComplaintOpen(false);setCategory('');setComplaintReason('');setComplaintConfirmed(false);}catch{setStatus('Não foi possível confirmar o registro da denúncia.');}
  finally{locked.current=false;setBusy(false);}
 }
 async function submitPreservation(){
  if(locked.current||view.role!=='owner'||!preserveEvidence||!preserveReason.trim())return;
  locked.current=true;setBusy(true);setStatus('');
  try{const result=await preserveEvidence(preserveReason.trim());setStatus('Solicitação '+result.id+' registrada para análise. Não confirma retenção ou divulgação.');setPreserveOpen(false);setPreserveReason('');}catch{setStatus('Não foi possível confirmar o registro da solicitação.');}
  finally{locked.current=false;setBusy(false);}
 }
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
  if(locked.current||(key==='close'?(!resolveOccurrence&&!actions.close)||view.role!=='owner'||view.closed||!!resolveOccurrence&&!resolution:!actions[key]))return;
  setMenu(false);setConfirmClose(false);locked.current=true;setBusy(true);setStatus('');
  try{if(key==='close'&&resolveOccurrence&&resolution)await resolveOccurrence(resolution);else await actions[key]!();}catch{setStatus('Não foi possível concluir a ação. Tente novamente.');}
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
    const enabled=(!!actions[key]||key==='close'&&!!resolveOccurrence||key==='preserve'&&view.role==='owner'&&!!preserveEvidence||key==='denounce'&&!!denounceOccurrence)&&!(key==='close'&&view.closed);
    return <button key={key} type="button" disabled={!enabled||busy} className="flex min-h-11 w-full items-center gap-2 rounded-lg p-2 text-left text-sm disabled:opacity-50" onClick={()=>{if(key==='close'){setResolution('');setConfirmClose(true);setMenu(false);}else if(key==='preserve'&&preserveEvidence){setMenu(false);setComplaintOpen(false);setPreserveOpen(true);}else if(key==='denounce'&&denounceOccurrence){setMenu(false);setPreserveOpen(false);setComplaintOpen(true);}else void run(key);}}><Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-[#F47825]"/><span>{label}{!enabled&&<span className="block text-xs text-slate-300">Indisponível</span>}</span></button>;
   })}
  </div>}
  {confirmClose&&<div role="group" aria-label="Confirmar encerramento" className="space-y-2 rounded-lg border border-amber-500/50 p-3"><p className="text-sm">Encerrar a ocorrência? O envio de novas mensagens será desabilitado.</p>{resolveOccurrence&&<fieldset className="space-y-2"><legend className="text-sm font-semibold">Motivo do encerramento</legend>{Object.entries(CID_SOS_RESOLUTION_LABELS).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="radio" name="cid-resolution" checked={resolution===key} onChange={()=>setResolution(key as CidSosResolution)}/>{label}</label>)}</fieldset>}<button type="button" className={field} disabled={!!resolveOccurrence&&!resolution} onClick={()=>void run('close')}>Confirmar encerramento</button><button type="button" className={field} onClick={()=>setConfirmClose(false)}>Cancelar</button></div>}
  {preserveOpen&&<form aria-label="Solicitar preservação de evidências" className="space-y-2 rounded-lg border border-amber-500/50 p-3" onSubmit={e=>{e.preventDefault();void submitPreservation();}}><p className="text-sm">A solicitação será analisada. Não autoriza acesso a IPs, divulgação nem retenção indefinida.</p><label className="block text-sm">Motivo da preservação<textarea className={field+' w-full bg-[#1D2924]'} aria-label="Motivo da preservação" maxLength={500} value={preserveReason} disabled={busy} onChange={e=>setPreserveReason(e.target.value)}/></label><button className={field} type="submit" disabled={busy||!preserveReason.trim()}>Solicitar preservação</button><button className={field} type="button" disabled={busy} onClick={()=>{setPreserveOpen(false);setPreserveReason('');}}>Cancelar</button></form>}
  {complaintOpen&&<form aria-label="Denunciar ocorrência" className="space-y-2 rounded-lg border border-amber-500/50 p-3" onSubmit={e=>{e.preventDefault();void submitComplaint();}}>
   <p className="text-sm">Este relato será encaminhado para análise administrativa. Não é uma chamada de emergência, uma denúncia policial ou uma comprovação de irregularidade.</p>
   <label className="block text-sm">Categoria<select aria-label="Categoria da denúncia" className={field+' w-full bg-[#1D2924]'} value={category} disabled={busy} onChange={e=>setCategory(e.target.value as CidComplaintCategory|'')}><option value="">Selecione</option>{Object.entries(CID_COMPLAINT_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="block text-sm">Relato<textarea aria-label="Relato da denúncia" className={field+' w-full bg-[#1D2924]'} maxLength={500} value={complaintReason} disabled={busy} onChange={e=>setComplaintReason(e.target.value)}/></label>
   <label className="flex gap-2 text-xs"><input type="checkbox" checked={complaintConfirmed} disabled={busy} onChange={e=>setComplaintConfirmed(e.target.checked)}/> Confirmo o envio deste relato para análise.</label>
   <button type="submit" className={field} disabled={busy||!category||!complaintReason.trim()||!complaintConfirmed}>Enviar denúncia</button>
   <button type="button" className={field} disabled={busy} onClick={()=>{setComplaintOpen(false);setCategory('');setComplaintReason('');setComplaintConfirmed(false);}}>Cancelar</button>
  </form>}
  {simulation&&<p className="text-xs text-amber-200">Simulação — nenhum alerta ou mensagem real.</p>}
  <aside className="space-y-1 rounded-lg border border-amber-500/40 p-3 text-xs"><strong>Uso responsável</strong><p>{CID_SOS_NOTICE}</p></aside>
  <div role="log" aria-label="Mensagens da ocorrência" aria-live="polite" className="max-h-[50vh] space-y-3 overflow-y-auto">
   {view.messages.map(m=><div key={m.id} className={'flex '+(m.mine?'justify-end':'justify-start')}><article className={'max-w-[85%] space-y-1 rounded-xl p-3 '+(m.mine?'bg-[#34443B]':'bg-[#26352C]')}><p className="break-words text-xs font-semibold text-[#F47825]">{m.kind==='system'?'Resposta automática':m.authorLabel}</p><p className="whitespace-pre-wrap break-words text-sm">{m.body}</p><p className="text-xs text-slate-300">{timeLabel(m.createdAt)}</p></article></div>)}
  </div>
  {view.closed?<p role="status" className="text-sm">Ocorrência encerrada. O histórico permanece disponível enquanto autorizado.{view.resolution?' Motivo: '+CID_SOS_RESOLUTION_LABELS[view.resolution]+'.':''}</p>:<form className="flex items-end gap-2" onSubmit={e=>{e.preventDefault();void send();}}>
   <textarea aria-label="Mensagem" placeholder="Escreva uma mensagem..." rows={2} maxLength={2000} className={field+' min-w-0 flex-1 resize-y bg-[#1D2924]'} disabled={busy} value={draft} onChange={e=>setDraft(e.target.value)}/>
   <button type="submit" aria-label="Enviar mensagem" disabled={busy||!draft.trim()} className="min-h-11 min-w-11 rounded-xl bg-[#F47825] p-3 text-[#121A17] disabled:opacity-50"><Send aria-hidden="true" className="h-5 w-5"/></button>
  </form>}
  {status&&<p role="status" className="text-xs">{status}</p>}
 </section>;
}
