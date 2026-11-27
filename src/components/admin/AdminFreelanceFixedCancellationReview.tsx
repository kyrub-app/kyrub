import HourlyAttachmentPreview,{validHourlyAttachments,type HourlyAttachment} from '../modals/HourlyAttachmentPreview';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Proposal={id:string;recognizedServiceMinor:number;reportedReceivedMinor:number;status:'pending'|'accepted'|'closed'|'stale'};
type Note={id:string;role:'worker'|'requester';note:string;recordedAt:string};
type Item={attachments:HourlyAttachment[];evidenceDigest:string;notes:Note[];proposalDigest:string;offerId:string;title:string;sourceDigest:string;requestedAt:string;capMinor:number;priorPaymentState:string;eligible:boolean;proposal:Proposal|null;bankVerified:false};
type Page={items:Item[];nextCursor:string|null};
const endpoint='/api/admin/freelance-financial-review';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50';
const field='mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const money=(v:number|null)=>v===null?'Indefinido':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const duration=(v:number|null)=>v===null?'Sem registro':Math.floor(v/60000)+' min '+Math.floor(v/1000)%60+' s';
const cents=(v:string)=>{const m=/^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(v.trim());return m?Number(m[1])*100+Number((m[2]??'').padEnd(2,'0')):null;};
const labels={pending:'Pendente',accepted:'Aceita',closed:'Encerrada',stale:'Desatualizada'};
const errors:Record<string,string>={second_factor_required:'Entre com autenticação multifator para consultar cancelamentos.',reauthentication_required:'Renove sua sessão com autenticação multifator.',FORBIDDEN:'Acesso administrativo não autorizado.',FREELANCE_FINANCIAL_REVIEW_CONFLICT:'A análise mudou. Consulte novamente antes de decidir.',FREELANCE_VARIABLE_PAYMENT_CONFLICT:'A base financeira mudou. Consulte novamente antes de decidir.'};
function validPage(v:unknown):v is Page{
 if(!v||typeof v!=='object')return false;
 const p=v as Page;
 return Array.isArray(p.items)&&p.items.length<=20&&(p.nextCursor===null||id(p.nextCursor))&&p.items.every(i=>i&&id(i.offerId)&&typeof i.title==='string'&&i.title.length<=120&&typeof i.sourceDigest==='string'&&/^[a-f0-9]{64}$/.test(i.sourceDigest)&&typeof i.requestedAt==='string'&&Number.isFinite(Date.parse(i.requestedAt))&&nonnegative(i.capMinor)&&i.capMinor<=999999999&&typeof i.eligible==='boolean'&&typeof i.priorPaymentState==='string'&&/^[a-f0-9]{64}$/.test(i.evidenceDigest)&&/^[a-f0-9]{64}$/.test(i.proposalDigest)&&Array.isArray(i.notes)&&i.notes.length<=4&&i.notes.every(n=>id(n.id)&&['worker','requester'].includes(n.role)&&typeof n.note==='string'&&n.note.length>=10&&n.note.length<=500&&typeof n.recordedAt==='string')&&validHourlyAttachments(i.attachments,2)&&i.bankVerified===false&&(i.proposal===null||i.proposal&&id(i.proposal.id)&&nonnegative(i.proposal.recognizedServiceMinor)&&i.proposal.recognizedServiceMinor<=i.capMinor&&nonnegative(i.proposal.reportedReceivedMinor)&&i.proposal.reportedReceivedMinor<=i.capMinor&&Object.hasOwn(labels,i.proposal.status)));
}
export default function AdminFreelanceFixedCancellationReview({user}:{user:User}){
 const [received,setReceived]=useState('');
 const [page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState<Item|null>(null),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 const reset=()=>{setSelected(null);setAmount('');setReceived('');setReason('');setConfirmed(false);};
 async function execute(kind:'list'|'decision',cursor?:string){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const minor=cents(amount),paid=cents(received);
  if(kind==='decision'&&(!selected||!selected.eligible||paid===null||paid>selected.capMinor||minor===null||minor>selected.capMinor||reason.trim().length<10||!confirmed))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');
  if(kind==='list'){reset();setPage(null);}
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const body=kind==='decision'?{action:'decide_fixed_cancellation',offerId:selected!.offerId,sourceDigest:selected!.sourceDigest,expectedRequestedAt:selected!.requestedAt,evidenceDigest:selected!.evidenceDigest,proposalDigest:selected!.proposalDigest,recognizedServiceMinor:minor,reportedReceivedMinor:paid,reason:reason.trim(),confirmed:true}:null;
   const q=body?'':'?view=fixed_cancellation'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   const r=await fetch(endpoint+q,{method:body?'POST':'GET',cache:'no-store',signal:ctl.signal,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const v=await r.json();if(!live())return;
   if(!r.ok)throw Error(errors[v?.code]??'Operação não confirmada.');
   if(kind==='list'){if(!validPage(v))throw Error('Resposta da fila não confirmada.');setPage(v);}
   else{if(v?.status!=='resolved_administratively'||v.bankVerified!==false)throw Error('Decisão não confirmada.');reset();setPage(null);setMessage('Decisão de cancelamento registrada. Consulte novamente.');}
  }catch(e){if(live()){setError(e instanceof Error?e.message:'Consulta indisponível.');reset();setPage(null);}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 const minor=cents(amount),paid=cents(received);
 return <section id="admin-freelance-fixed-cancellation-review" className="space-y-3 border-t border-slate-700 pt-3">
  <h3 className="text-base font-bold text-white">Cancelamentos por preço fechado</h3>
  <p>Homologação isolada. A decisão reconhece valor do serviço, sem determinar indenização ou comprovar pagamento.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void execute('list')}>Consultar cancelamentos por preço fechado</button>
  {error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status">{message}</p>}
  {page?.items.length===0&&<p>Nenhum cancelamento pendente nesta página.</p>}
  {page?.items.map(i=><article key={i.offerId} className="rounded-xl border border-slate-800 p-3 space-y-2"><h4 className="text-base font-bold break-words">{i.title}</h4><p>Valor contratado: {money(i.capMinor)}</p><p>Solicitação: {new Date(i.requestedAt).toLocaleString('pt-BR')}</p><button type="button" className={btn} disabled={busy} onClick={()=>{reset();setSelected(i);}}>Analisar preço fechado</button></article>)}
  {page?.nextCursor&&<button type="button" className={btn} disabled={busy} onClick={()=>void execute('list',page.nextCursor!)}>Próxima página de cancelamentos</button>}
  {selected&&<form className="space-y-3 rounded-xl border border-slate-700 p-3" onSubmit={e=>{e.preventDefault();void execute('decision');}}>
   <h4 className="text-base font-bold break-words">{selected.title}</h4><p className="break-all">Protocolo: {selected.offerId}</p>
   <p>Valor contratado: {money(selected.capMinor)} · Pagamento original: {selected.priorPaymentState}</p>{!selected.eligible&&<p>Regularize o pagamento original antes da decisão.</p>}
   <p>Proposta corrente: {selected.proposal?money(selected.proposal.recognizedServiceMinor)+' · '+labels[selected.proposal.status]+' · Recebido declarado: '+money(selected.proposal.reportedReceivedMinor):'Nenhuma'}</p>
   <div className="space-y-2"><h5 className="font-bold">Manifestações privadas</h5>{selected.notes.length===0&&<p>Nenhuma manifestação registrada.</p>}{selected.notes.map(n=><div key={n.id} className="rounded border border-slate-700 p-2"><p>{n.role==='worker'?'Profissional':'Contratante'} · {new Date(n.recordedAt).toLocaleString('pt-BR')}</p><p className="whitespace-pre-wrap break-words">{n.note}</p></div>)}<h5 className="font-bold">Anexos privados</h5>{selected.attachments.length===0&&<p>Nenhum anexo registrado.</p>}{selected.attachments.map(a=><HourlyAttachmentPreview key={selected.offerId+':'+a.id} user={user} offerId={selected.offerId} kind="fixed_cancellation" attachment={a} admin/>)}<p>Anexos não representam confirmação bancária.</p></div>
   <label className="block">Valor reconhecido (R$)<input className={field} inputMode="decimal" value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value);setConfirmed(false);}}/></label>
   <label className="block">Valor recebido reconhecido (R$)<input className={field} inputMode="decimal" value={received} disabled={busy} onChange={e=>{setReceived(e.target.value);setConfirmed(false);}}/></label>
   {minor!==null&&paid!==null&&<p>Complemento: {money(Math.max(0,minor-paid))} · Devolução: {money(Math.max(0,paid-minor))}</p>}
   <label className="block">Fundamentação do cancelamento<textarea className={field} required minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo o valor e a decisão fundamentada. A restrição deste caso será removida, sem quitação.</label>
   <button type="submit" className={btn} disabled={busy||!selected.eligible||paid===null||paid>selected.capMinor||!confirmed||minor===null||minor>selected.capMinor||reason.trim().length<10}>Registrar decisão de cancelamento</button>{' '}<button type="button" className={btn} disabled={busy} onClick={reset}>Voltar</button>
  </form>}
 </section>;
}
