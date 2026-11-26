import {useRef,useState} from 'react';
import {CID_REVIEW_DISPOSITIONS,type CidEvidenceReviewAdapter,type CidReviewQueueItem,type CidReviewDetail,type CidReviewDisposition} from '../../shared/cidEvidenceReview';
import {CID_COMPLAINT_CATEGORIES} from '../../shared/cidOccurrenceComplaint';
const field='min-h-11 rounded-xl border border-[#34443B] p-3 text-sm disabled:opacity-50';
const statuses={'pending-review':'Pendente de análise',dismissed:'Arquivada',escalated:'Encaminhada para análise especializada'} as const;
export function KyrubCidEvidenceReviewHomologation({adapter}:{adapter:CidEvidenceReviewAdapter}){
 const [items,setItems]=useState<CidReviewQueueItem[]>([]),[loaded,setLoaded]=useState(false),[more,setMore]=useState(false),[detail,setDetail]=useState<CidReviewDetail|null>(null);
 const [decision,setDecision]=useState<CidReviewDisposition|''>(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const lock=useRef(false);
 async function run(action:()=>Promise<void>){
  if(lock.current)return;lock.current=true;setBusy(true);setStatus('');
  try{await action();}catch{setDetail(null);setItems([]);setLoaded(false);setDecision('');setReason('');setStatus('Operação não confirmada. Confira a sessão e atualize a fila.');}
  finally{lock.current=false;setBusy(false);}
 }
 async function refresh(){const result=await adapter.list();setItems(result.items);setMore(result.hasMore);setLoaded(true);}
 return <section aria-label="Preservação de Evidências e Cooperação com Autoridades" className="mx-auto max-w-3xl space-y-3 rounded-xl bg-[#121A17] p-4 text-[#F5F5F3]">
  <h2 className="text-base font-bold">Preservação de Evidências e Cooperação com Autoridades</h2>
  <p className="text-xs text-amber-200">Homologação isolada · triagem de solicitações fictícias. Não há acesso a registros técnicos ou envio a autoridades.</p>
  <button type="button" className={field} disabled={busy} onClick={()=>void run(async()=>{setDetail(null);setReason('');setDecision('');await refresh();})}>Consultar fila de análise</button>
  {loaded&&!items.length&&<p>Nenhuma solicitação.</p>}
  {items.map(i=><button className={field+' block w-full text-left'} type="button" key={i.id} disabled={busy} onClick={()=>void run(async()=>{setDetail(null);setDecision('');setReason('');setDetail(await adapter.detail(i.id));})}><strong>{i.kind==='complaint'?'Denúncia de ocorrência':'Pedido de preservação'}</strong><span className="block text-xs">{statuses[i.status]} · {i.id}</span></button>)}
  {more&&<p className="text-xs">Exibindo os 50 registros mais recentes. Existem registros anteriores.</p>}
  {detail&&<article className="space-y-3 rounded-xl border border-[#34443B] p-3">
   <h3 className="text-base font-semibold">Protocolo {detail.item.id}</h3>
   <p className="text-xs">{statuses[detail.item.status]}</p>
   <p className="text-xs">Ocorrência: {detail.item.occurrenceId}</p>
   {detail.category&&<p className="text-sm">{CID_COMPLAINT_CATEGORIES[detail.category as keyof typeof CID_COMPLAINT_CATEGORIES]??detail.category}</p>}
   <p className="text-sm whitespace-pre-wrap break-words">{detail.reason}</p>
   {detail.item.status==='pending-review'&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();if(!decision||!reason.trim())return;void run(async()=>{const result=await adapter.decide({id:detail.item.id,expectedRevision:detail.item.revision,disposition:decision,reason:reason.trim()});setDetail(null);setDecision('');setReason('');await refresh();setStatus('Triagem registrada: '+statuses[result.status]+'.');});}}>
    <label className="block text-sm">Decisão de triagem<select className={field+' block w-full bg-[#1D2924]'} aria-label="Decisão de triagem" value={decision} disabled={busy} onChange={e=>setDecision(e.target.value as CidReviewDisposition|'')}><option value="">Selecione</option>{Object.entries(CID_REVIEW_DISPOSITIONS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <label className="block text-sm">Justificativa da decisão<textarea aria-label="Justificativa da decisão" className={field+' block w-full bg-[#1D2924]'} maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <p className="text-xs">Encaminhar não aprova retenção nem divulgação. Arquivar não comprova improcedência e não exclui registros.</p>
    <button type="submit" className={field} disabled={busy||!decision||!reason.trim()}>Registrar decisão de triagem</button>
   </form>}
   <button type="button" className={field} disabled={busy} onClick={()=>{setDetail(null);setReason('');setDecision('');}}>Fechar solicitação</button>
  </article>}
  {status&&<p role="status" className="text-sm">{status}</p>}
 </section>;
}
