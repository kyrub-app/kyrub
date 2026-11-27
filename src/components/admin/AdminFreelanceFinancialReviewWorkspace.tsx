import AdminFreelanceCancellationReview from './AdminFreelanceCancellationReview';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Role='requester'|'freelancer';
type Outcome='payment_evidence_accepted'|'nonreceipt_evidence_accepted'|'inconclusive';
type Item={offerId:string;title:string;amountMinor:number;currency:'BRL';timing:'advance'|'on_completion';requestedAt:string;requestedByRole:Role;requesterUid:string;beneficiaryUid:string;statements:{role:Role;statement:'paid'|'received'|'not_received';recordedAt:string}[];evidenceRevision:number;evidenceNotes:{role:Role;note:string;recordedAt:string}[];receipts:{id:string;role:Role;recordedAt:string;size:number;mimeType:'image/png'}[];restrictionActive:true;bankVerified:false;settlementEvidence:'participant_statements_only'};
type Page={items:Item[];nextCursor:string|null};
const endpoint='/api/admin/freelance-financial-review';
const outcomes:Record<Outcome,string>={payment_evidence_accepted:'Evidências favoráveis ao pagamento',nonreceipt_evidence_accepted:'Evidências favoráveis ao não recebimento',inconclusive:'Inconclusivo'};
const statements={paid:'Pagamento informado',received:'Recebimento confirmado',not_received:'Recebimento negado'};
const errors:Record<string,string>={FREELANCE_FINANCIAL_REVIEW_DISABLED:'Área disponível apenas para homologação isolada.',second_factor_required:'Entre com autenticação multifator para consultar divergências.',reauthentication_required:'Renove sua sessão com autenticação multifator.',FORBIDDEN:'Acesso administrativo não autorizado.',AUTH_REQUIRED:'Entre novamente para continuar.',FREELANCE_FINANCIAL_REVIEW_CONFLICT:'A divergência ou suas evidências mudaram. Consulte novamente antes de decidir.'};
const button='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50';
const field='mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
const uid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const role=(v:unknown)=>v==='requester'||v==='freelancer';
const who=(r:Role)=>r==='requester'?'Contratante':'Contratado';
const when=(v:string)=>new Date(v).toLocaleString('pt-BR');
function validPage(v:unknown):v is Page{
 if(!v||typeof v!=='object')return false;
 const p=v as Page;
 return Array.isArray(p.items)&&p.items.length<=20&&(p.nextCursor===null||uid(p.nextCursor))&&p.items.every(i=>
  i&&uid(i.offerId)&&typeof i.title==='string'&&i.title.length<=120&&Number.isSafeInteger(i.amountMinor)&&i.amountMinor>0&&i.currency==='BRL'&&
  ['advance','on_completion'].includes(i.timing)&&date(i.requestedAt)&&role(i.requestedByRole)&&uid(i.requesterUid)&&uid(i.beneficiaryUid)&&i.requesterUid!==i.beneficiaryUid&&
  i.restrictionActive===true&&i.bankVerified===false&&i.settlementEvidence==='participant_statements_only'&&
  Array.isArray(i.statements)&&i.statements.length===2&&i.statements.every(s=>role(s.role)&&Object.hasOwn(statements,s.statement)&&date(s.recordedAt))&&
  Array.isArray(i.evidenceNotes)&&i.evidenceNotes.length<=4&&i.evidenceNotes.every(n=>role(n.role)&&typeof n.note==='string'&&n.note.length<=500&&date(n.recordedAt))&&
  Array.isArray(i.receipts)&&i.receipts.length<=2&&i.receipts.every(r=>uid(r.id)&&role(r.role)&&r.mimeType==='image/png'&&date(r.recordedAt)&&Number.isSafeInteger(r.size)&&r.size>0&&r.size<=262144)&&
  i.evidenceRevision===i.evidenceNotes.length+i.receipts.length);
}
export default function AdminFreelanceFinancialReviewWorkspace({user}:{user:User}){
 const [page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState<Item|null>(null);
 const [outcome,setOutcome]=useState<Outcome|''>(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [image,setImage]=useState<{url:string;id:string}|null>(null);
 const [viewed,setViewed]=useState<string[]>([]);
 const ticket=useRef(0),lock=useRef(false),request=useRef<AbortController|null>(null),imageUrl=useRef<string|null>(null);
 const clearImage=()=>{if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);imageUrl.current=null;setImage(null);};
 useEffect(()=>()=>{ticket.current++;request.current?.abort();if(imageUrl.current)URL.revokeObjectURL(imageUrl.current);},[]);
 const reset=()=>{clearImage();setViewed([]);setSelected(null);setOutcome('');setReason('');setConfirmed(false);};
 const execute=async(kind:'list'|'receipt'|'decision',arg?:string)=>{
  if(lock.current||auth.currentUser?.uid!==user.uid)return;
  if(kind!=='list'&&!selected)return;
  if(kind==='decision'&&(!outcome||!confirmed||reason.trim().length<10||!selected?.receipts.every(r=>viewed.includes(r.id))))return;
  lock.current=true;const id=++ticket.current,abort=new AbortController();request.current=abort;
  const active=()=>ticket.current===id&&!abort.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');clearImage();
  if(kind==='list'){setPage(null);reset();}
  try{
   const token=await user.getIdToken(true);if(!active())return;
   const q=kind==='receipt'?'?view=receipt&offerId='+encodeURIComponent(selected!.offerId)+'&receiptId='+encodeURIComponent(arg!):kind==='list'&&arg?'?cursor='+encodeURIComponent(arg):'';
   const body=kind==='decision'?{offerId:selected!.offerId,expectedRequestedAt:selected!.requestedAt,expectedEvidenceRevision:selected!.evidenceRevision,outcome,reason:reason.trim(),confirmed}:null;
   const res=await fetch(endpoint+q,{method:body?'POST':'GET',cache:'no-store',signal:abort.signal,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const data=await res.json().catch(()=>null);if(!active())return;
   if(!res.ok)throw Error(errors[data?.code]??'Operação administrativa não confirmada.');
   if(kind==='list'){
    if(!validPage(data)||data.items.some(i=>i.requesterUid===user.uid||i.beneficiaryUid===user.uid))throw Error('Resposta da fila não confirmada.');
    setPage(data);
   }else if(kind==='receipt'){
    const meta=selected!.receipts.find(r=>r.id===arg);
    if(!meta||data?.id!==arg||data.mimeType!=='image/png'||data.bankVerified!==false||typeof data.pngBase64!=='string'||data.pngBase64.length>349528)throw Error('Comprovante não confirmado.');
    const bytes=Uint8Array.from(atob(data.pngBase64),c=>c.charCodeAt(0));
    if(bytes.length!==meta.size||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw Error('Comprovante não confirmado.');
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));imageUrl.current=url;setImage({url,id:meta.id});setConfirmed(false);
   }else{
    if(data?.status!=='resolved_administratively'||data.outcome!==outcome||data.bankVerified!==false)throw Error('Decisão não confirmada.');
    reset();setPage(null);setMessage('Decisão administrativa registrada. Consulte a fila novamente.');
   }
  }catch(e){if(active()){setError(e instanceof Error?e.message:'Consulta indisponível.');reset();setPage(null);}}
  finally{if(active()){lock.current=false;setBusy(false);}}
 };
 if(auth.currentUser?.uid!==user.uid)return null;
 return <section id="admin-freelance-financial-review-workspace" className="space-y-3 text-sm text-slate-300">
  <p>Homologação isolada. Consulte apenas protocolos fictícios. A decisão encerra a restrição deste caso, sem transferência, quitação ou verificação bancária.</p>
  <button type="button" className={button} disabled={busy} onClick={()=>void execute('list')}>Consultar divergências</button>
  {busy&&<p role="status">Consultando servidor…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status" className="text-emerald-300">{message}</p>}
  {page?.items.length===0&&<p>Nenhuma divergência pendente nesta página.</p>}
  {page?.items.map(i=><article key={i.offerId} className="rounded-xl border border-slate-800 p-3 space-y-2">
   <h3 className="text-base font-bold text-white break-words">{i.title}</h3>
   <p>{new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(i.amountMinor/100)} · {i.timing==='advance'?'Antecipado':'Na conclusão'}</p>
   <p>Solicitada por {who(i.requestedByRole)} · {when(i.requestedAt)}</p><p className="text-amber-300">Restrição bilateral ativa</p>
   <p>{i.evidenceNotes.length} manifestação(ões) · {i.receipts.length} comprovante(s)</p>
   <button type="button" className={button} disabled={busy} onClick={()=>{reset();setSelected(i);}}>Analisar divergência</button>
  </article>)}
  {page?.nextCursor&&<button type="button" className={button} disabled={busy} onClick={()=>void execute('list',page.nextCursor!)}>Próxima página</button>}
  {selected&&<form className="space-y-3 rounded-xl border border-slate-700 p-3" onSubmit={e=>{e.preventDefault();void execute('decision');}}>
   <h3 className="text-base font-bold text-white break-words">Análise: {selected.title}</h3>
   <p className="break-all">Protocolo: {selected.offerId}</p><p className="break-all">Contratante: {selected.requesterUid}</p><p className="break-all">Contratado: {selected.beneficiaryUid}</p>
   <h4 className="font-bold">Histórico financeiro</h4>
   {selected.statements.map((s,i)=><p key={i}>{who(s.role)}: {statements[s.statement]} · {when(s.recordedAt)}</p>)}
   <h4 className="font-bold">Manifestações privadas</h4>
   {selected.evidenceNotes.length===0&&<p>Nenhuma manifestação complementar.</p>}
   {selected.evidenceNotes.map((n,i)=><div key={i} className="rounded-xl border border-slate-800 p-2"><p>{who(n.role)} · {when(n.recordedAt)}</p><p className="whitespace-pre-wrap break-words">{n.note}</p></div>)}
   <h4 className="font-bold">Comprovantes privados</h4>
   {selected.receipts.length===0&&<p>Nenhum comprovante apresentado.</p>}
   {selected.receipts.map(r=><div key={r.id} className="flex flex-wrap items-center gap-2"><span>{who(r.role)} · {when(r.recordedAt)}</span><button type="button" className={button} disabled={busy} onClick={()=>void execute('receipt',r.id)}>Visualizar comprovante de {who(r.role).toLowerCase()}</button>{viewed.includes(r.id)&&<span>Visualizado</span>}</div>)}
   {image&&<div className="space-y-2"><img src={image.url} alt="Comprovante privado apresentado" className="max-w-full max-h-[55vh] object-contain" onLoad={()=>setViewed(v=>v.includes(image.id)?v:[...v,image.id])} onError={()=>{clearImage();setError('Não foi possível visualizar o comprovante.');}}/><button type="button" className={button} onClick={clearImage}>Fechar comprovante</button></div>}
   <label className="block">Resultado da análise<select className={field} required value={outcome} disabled={busy} onChange={e=>{setOutcome(e.target.value as Outcome|'');setConfirmed(false);}}><option value="">Selecione o resultado</option>{Object.entries(outcomes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label className="block">Fundamentação<textarea className={field} required minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a decisão fundamentada e a liberação das restrições deste protocolo. Não representa quitação nem confirmação bancária.</label>
   <button type="submit" className={button} disabled={busy||!confirmed||!outcome||reason.trim().length<10||!selected.receipts.every(r=>viewed.includes(r.id))}>Registrar decisão financeira</button>{' '}
   <button type="button" className={button} disabled={busy} onClick={reset}>Voltar</button>
  </form>}
  <AdminFreelanceCancellationReview key={user.uid} user={user}/>
 </section>;
}
