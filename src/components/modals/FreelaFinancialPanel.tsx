import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import FreelaPixSharing from './FreelaPixSharing';
import FreelaCancellationAccounting from './FreelaCancellationAccounting';
type Statement={role:'requester'|'freelancer';statement:'paid'|'received'|'not_received';recordedAt:string};
type Case={offerId:string;role:'requester'|'freelancer';amountMinor:number;currency:'BRL';timing:'advance'|'on_completion';due:boolean;operationalStatus:string;financialState:string;restrictionActive:boolean;reviewStatus:string|null;reviewOutcome:string|null;bankVerified:false;statements:Statement[];ownNotes:{id:string;note:string;recordedAt:string}[];ownReceipts:{id:string;size:number;recordedAt:string;mimeType:'image/png'}[];canRequestReview:boolean;canSubmitEvidence:boolean};
type Action={action:string;confirmed:true;eventId?:string;statement?:Statement['statement'];evidenceId?:string;note?:string;receiptId?:string;pngBase64?:string};
const states:Record<string,string>={not_due:'Pagamento previsto para a conclusão',awaiting_payment:'Aguardando pagamento',awaiting_receipt:'Aguardando confirmação de recebimento',nonreceipt_reported:'Não recebimento informado',disputed:'Divergência financeira',receipt_reported:'Recebimento informado',bilaterally_reported_received:'Recebimento confirmado pelas partes'};
const statements:Record<string,string>={paid:'Pagamento informado',received:'Recebimento confirmado',not_received:'Recebimento negado'};
const reviews:Record<string,string>={pending:'Análise administrativa solicitada',resolved_voluntarily:'Regularização voluntária registrada',resolved_administratively:'Análise administrativa encerrada'};
const outcomes:Record<string,string>={payment_evidence_accepted:'Evidências favoráveis ao pagamento',nonreceipt_evidence_accepted:'Evidências favoráveis ao não recebimento',inconclusive:'Inconclusivo'};
const errors:Record<string,string>={FREELANCE_PAYMENT_NOT_DUE:'O pagamento ainda não está previsto nesta etapa.',FREELANCE_FINANCE_DISABLED:'Financeiro de homologação indisponível.',AUTH_REQUIRED:'Entre novamente para continuar.',FREELANCE_FORBIDDEN:'Operação não autorizada.',FREELANCE_RECEIPT_INVALID:'PNG inválido ou fora dos limites.',FREELANCE_FINANCIAL_EVIDENCE_CONFLICT:'Evidência indisponível, limite atingido ou análise encerrada.',FREELANCE_FINANCIAL_REVIEW_CONFLICT:'A análise mudou. Atualize a consulta.',FREELANCE_PAYMENT_STATEMENT_CONFLICT:'A situação financeira mudou. Atualize a consulta.'};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const field='w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-white';
function valid(v:unknown,id:string,role:Case['role']):v is Case{
 if(!v||typeof v!=='object')return false;
 const c=v as Case;
 return c.offerId===id&&c.role===role&&c.bankVerified===false&&c.currency==='BRL'&&Number.isSafeInteger(c.amountMinor)&&c.amountMinor>0&&
 ['advance','on_completion'].includes(c.timing)&&typeof c.due==='boolean'&&['contracted','in_progress','completion_requested','completed','under_review','cancelled'].includes(c.operationalStatus)&&(c.due?c.financialState!=='not_due':c.financialState==='not_due')&&Object.hasOwn(states,c.financialState)&&typeof c.restrictionActive==='boolean'&&
 (c.reviewStatus===null||Object.hasOwn(reviews,c.reviewStatus))&&(c.reviewOutcome===null||Object.hasOwn(outcomes,c.reviewOutcome))&&
 typeof c.canRequestReview==='boolean'&&typeof c.canSubmitEvidence==='boolean'&&Array.isArray(c.statements)&&c.statements.length<=3&&
 c.statements.every(s=>['requester','freelancer'].includes(s.role)&&Object.hasOwn(statements,s.statement)&&typeof s.recordedAt==='string')&&
 Array.isArray(c.ownNotes)&&c.ownNotes.length<=2&&c.ownNotes.every(n=>typeof n.id==='string'&&typeof n.note==='string'&&typeof n.recordedAt==='string')&&
 Array.isArray(c.ownReceipts)&&c.ownReceipts.length<=1&&c.ownReceipts.every(r=>typeof r.id==='string'&&r.mimeType==='image/png'&&Number.isSafeInteger(r.size)&&r.size>0&&r.size<=262144);
}
export default function FreelaFinancialPanel({user,offerId,role,operationalStatus}:{user:User;offerId:string;role:Case['role'];operationalStatus?:string}){
 const [data,setData]=useState<Case|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [pending,setPending]=useState<{label:string;body:Action}|null>(null),[note,setNote]=useState(''),[file,setFile]=useState<File|null>(null);
 const ticket=useRef(0),lock=useRef(false),controller=useRef<AbortController|null>(null),fileInput=useRef<HTMLInputElement|null>(null);
 useEffect(()=>()=>{ticket.current++;controller.current?.abort();},[]);
 const clear=()=>{setPending(null);setNote('');setFile(null);if(fileInput.current)fileInput.current.value='';};
 const run=async(body?:Action)=>{
  if(lock.current||auth.currentUser?.uid!==user.uid)return;
  lock.current=true;const id=++ticket.current,abort=new AbortController();controller.current=abort;
  const active=()=>ticket.current===id&&!abort.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');if(!body){setData(null);clear();}
  try{
   const token=await user.getIdToken();if(!active())return;
   const headers={authorization:'Bearer '+token};
   if(body){
    const res=await fetch('/api/freelance/finance',{method:'POST',cache:'no-store',signal:abort.signal,headers:{...headers,'content-type':'application/json'},body:JSON.stringify({offerId,...body})});
    const payload=await res.json().catch(()=>null);if(!active())return;
    if(!res.ok||payload?.confirmed!==true)throw Error(errors[payload?.code]??'Operação não confirmada.');
    setData(null);clear();setMessage('Manifestação registrada pelo servidor.');
   }
   const res=await fetch('/api/freelance/finance?view=case&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:abort.signal});
   const payload=await res.json().catch(()=>null);if(!active())return;
   if(!res.ok||!valid(payload,offerId,role))throw Error(errors[payload?.code]??'Consulta financeira não confirmada.');
   setData(payload);
  }catch(e){if(active()){setError(e instanceof Error?e.message:'Operação indisponível.');setData(null);}}
  finally{if(active()){lock.current=false;setBusy(false);}}
 };
 const ask=(label:string,body:Action)=>setPending({label,body});
 const statement=(label:string,value:Statement['statement'])=>ask(label,{action:'statement',eventId:crypto.randomUUID(),statement:value,confirmed:true});
 const prepareReceipt=async()=>{
  if(!file||file.size>262144||file.size<1||file.type!=='image/png'||busy||pending||lock.current)return;
  lock.current=true;const id=++ticket.current;
  const active=()=>ticket.current===id&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());if(!active())return;
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   ask('Enviar comprovante privado',{action:'submit_receipt',receiptId:crypto.randomUUID(),pngBase64:btoa(binary),confirmed:true});
   setFile(null);if(fileInput.current)fileInput.current.value='';
  }catch{if(active())setError('Não foi possível ler o arquivo.');}
  finally{if(active()){lock.current=false;setBusy(false);}}
 };
 const paused=['under_review','cancelled'].includes(data?.operationalStatus??operationalStatus??'');
 const paid=data?.statements.some(s=>s.statement==='paid'),received=data?.statements.some(s=>s.statement==='received'),denied=data?.statements.some(s=>s.statement==='not_received');
 if(auth.currentUser?.uid!==user.uid)return null;
 return <section aria-label="Financeiro do Freela" className="rounded-xl border border-slate-700 p-3 space-y-3 text-sm">
  <h4 className="text-base font-bold text-white">Financeiro do Freela</h4>
  <p>Homologação: use somente dados e comprovantes fictícios. O Kyrub não realiza transferências nem confirma pagamentos bancários.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void run()}>Consultar situação financeira</button>
  {busy&&<p role="status">Consultando financeiro…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status" className="text-emerald-300">{message}</p>}
  {!busy&&!paused&&!paid&&!received&&!data?.reviewStatus&&<FreelaPixSharing key={user.uid+':'+offerId} user={user} offerId={offerId} role={role}/>}
  {data&&<>
   <p className="font-bold text-white">{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(data.amountMinor/100)} · {data.timing==='advance'?'Antecipado':'Na conclusão'}</p>
   {paused?<><p className="text-amber-300">{data.operationalStatus==='cancelled'?'Serviço cancelado. Tratamento financeiro pendente.':'Serviço em análise operacional.'} O valor acordado não representa saldo exigível. Não envie novo pagamento por este painel.</p>{data.due&&<p>Histórico de pagamento antecipado: {states[data.financialState]}. Registre somente fatos de pagamentos ou recebimentos já ocorridos.</p>}</>:<p>{states[data.financialState]}</p>}
   {data.reviewStatus&&<p>{reviews[data.reviewStatus]}</p>}{data.reviewOutcome&&<p>{outcomes[data.reviewOutcome]}</p>}
   {data.restrictionActive&&<p className="text-amber-300">Novas contratações temporariamente indisponíveis para ambas as partes.</p>}
   {data.statements.map((s,i)=><p key={i} className="break-words">{s.role==='requester'?'Contratante':'Contratado'}: {statements[s.statement]} · {new Date(s.recordedAt).toLocaleString('pt-BR')}</p>)}
   <div className="flex flex-wrap gap-2">
    {data.due&&role==='requester'&&!paid&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>statement('Informar pagamento','paid')}>Informar pagamento</button>}
    {data.due&&role==='freelancer'&&!received&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>statement('Confirmar recebimento','received')}>Confirmar recebimento</button>}
    {data.due&&role==='freelancer'&&!received&&!denied&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>statement('Informar não recebimento','not_received')}>Informar não recebimento</button>}
    {data.canRequestReview&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>ask('Solicitar análise administrativa',{action:'request_review',confirmed:true})}>Solicitar análise administrativa</button>}
   </div>
   {data.canSubmitEvidence&&<div className="space-y-2">
    <h5 className="font-bold">Minhas evidências privadas</h5>
    {data.ownNotes.map(n=><p key={n.id} className="whitespace-pre-wrap break-words">{n.note}</p>)}
    {data.ownNotes.length<2&&<><label className="block">Manifestação complementar<textarea className={field} maxLength={500} value={note} disabled={busy||!!pending} onChange={e=>setNote(e.target.value)}/></label><button type="button" className={btn} disabled={busy||!!pending||note.trim().length<10} onClick={()=>ask('Enviar manifestação privada',{action:'submit_note',evidenceId:crypto.randomUUID(),note:note.trim(),confirmed:true})}>Enviar manifestação</button></>}
    {data.ownReceipts.length===0?<><label className="block">Comprovante fictício PNG (até 256 KiB)<input ref={fileInput} className={field} type="file" accept="image/png" disabled={busy||!!pending} onChange={e=>{const f=e.target.files?.[0];setError('');if(f&&(f.size>262144||f.type!=='image/png'||!f.size)){setFile(null);e.target.value='';setError('Selecione um PNG de até 256 KiB.');}else setFile(f??null);}}/></label><button type="button" className={btn} disabled={busy||!!pending||!file} onClick={()=>void prepareReceipt()}>Enviar comprovante</button></>:<p>Comprovante privado registrado.</p>}
   </div>}
  </>}
  {!busy&&!pending&&(data?.operationalStatus??operationalStatus)==='cancelled'&&<FreelaCancellationAccounting key={user.uid+':'+offerId} user={user} offerId={offerId}/>}
  {pending&&<div className="rounded-xl border border-teal-700 p-3 space-y-2"><p>Confirma: {pending.label}?</p><button type="button" className={btn} disabled={busy} onClick={()=>void run(pending.body)}>Confirmar manifestação</button>{' '}<button type="button" className={btn} disabled={busy} onClick={clear}>Voltar</button></div>}
 </section>;
}
