import HourlyAttachmentPreview,{validHourlyAttachments,type HourlyAttachment} from '../modals/HourlyAttachmentPreview';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Statement={role:'payer'|'recipient';statement:'paid'|'received'|'not_received';recordedAt:string};
type Note={id:string;role:'worker'|'requester';note:string;recordedAt:string};
type Item={attachments:HourlyAttachment[];evidenceDigest:string;notes:Note[];statementDigest:string;offerId:string;title:string;sourceDigest:string;requestedAt:string;amountMinor:number;direction:'additional'|'refund';statements:Statement[];bankVerified:false};
type Page={items:Item[];nextCursor:string|null};
const endpoint='/api/admin/freelance-financial-review';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50';
const field='mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const money=(v:number|null)=>v===null?'Indefinido':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const duration=(v:number|null)=>v===null?'Sem registro':Math.floor(v/60000)+' min '+Math.floor(v/1000)%60+' s';
const cents=(v:string)=>{const m=/^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(v.trim());return m?Number(m[1])*100+Number((m[2]??'').padEnd(2,'0')):null;};
const labels={paid:'Pagamento informado',received:'Recebimento informado',not_received:'Não recebimento informado'};
const outcomes={payment_evidence_accepted:'Evidências de pagamento acolhidas',nonreceipt_evidence_accepted:'Evidências de não recebimento acolhidas',inconclusive:'Inconclusiva'};
const errors:Record<string,string>={second_factor_required:'Entre com autenticação multifator para consultar regularizações.',reauthentication_required:'Renove sua sessão com autenticação multifator.',FORBIDDEN:'Acesso administrativo não autorizado.',FREELANCE_FINANCIAL_REVIEW_CONFLICT:'A análise mudou. Consulte novamente antes de decidir.',FREELANCE_VARIABLE_PAYMENT_CONFLICT:'A base financeira mudou. Consulte novamente antes de decidir.'};
function validPage(v:unknown):v is Page{
 if(!v||typeof v!=='object')return false;
 const p=v as Page;
 return Array.isArray(p.items)&&p.items.length<=20&&(p.nextCursor===null||id(p.nextCursor))&&p.items.every(i=>i&&id(i.offerId)&&typeof i.title==='string'&&i.title.length<=120&&typeof i.sourceDigest==='string'&&/^[a-f0-9]{64}$/.test(i.sourceDigest)&&typeof i.requestedAt==='string'&&Number.isFinite(Date.parse(i.requestedAt))&&nonnegative(i.amountMinor)&&i.amountMinor>0&&i.amountMinor<=999999999&&['additional','refund'].includes(i.direction)&&/^[a-f0-9]{64}$/.test(i.evidenceDigest)&&/^[a-f0-9]{64}$/.test(i.statementDigest)&&Array.isArray(i.notes)&&i.notes.length<=4&&i.notes.every(n=>id(n.id)&&['worker','requester'].includes(n.role)&&typeof n.note==='string'&&n.note.length>=10&&n.note.length<=500&&typeof n.recordedAt==='string')&&validHourlyAttachments(i.attachments,2)&&i.bankVerified===false&&Array.isArray(i.statements)&&i.statements.length===2&&i.statements.every(s=>['payer','recipient'].includes(s.role)&&Object.hasOwn(labels,s.statement)&&typeof s.recordedAt==='string'));
}
export default function AdminFreelanceFixedAdjustmentReview({user}:{user:User}){
 const [outcome,setOutcome]=useState('');
 const [page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState<Item|null>(null),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 const reset=()=>{setSelected(null);setOutcome('');setReason('');setConfirmed(false);};
 async function execute(kind:'list'|'decision',cursor?:string){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
   if(kind==='decision'&&(!selected||!Object.hasOwn(outcomes,outcome)||reason.trim().length<10||!confirmed))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');
  if(kind==='list'){reset();setPage(null);}
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const body=kind==='decision'?{action:'decide_fixed_adjustment',offerId:selected!.offerId,sourceDigest:selected!.sourceDigest,expectedRequestedAt:selected!.requestedAt,evidenceDigest:selected!.evidenceDigest,statementDigest:selected!.statementDigest,expectedAmountMinor:selected!.amountMinor,outcome,reason:reason.trim(),confirmed:true}:null;
   const q=body?'':'?view=fixed_adjustment'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   const r=await fetch(endpoint+q,{method:body?'POST':'GET',cache:'no-store',signal:ctl.signal,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const v=await r.json();if(!live())return;
   if(!r.ok)throw Error(errors[v?.code]??'Operação não confirmada.');
   if(kind==='list'){if(!validPage(v))throw Error('Resposta da fila não confirmada.');setPage(v);}
   else{if(v?.status!=='resolved_administratively'||v.bankVerified!==false)throw Error('Decisão não confirmada.');reset();setPage(null);setMessage('Decisão de regularização registrada. Consulte novamente.');}
  }catch(e){if(live()){setError(e instanceof Error?e.message:'Consulta indisponível.');reset();setPage(null);}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 return <section id="admin-freelance-fixed-adjustment-review" className="space-y-3 border-t border-slate-700 pt-3">
  <h3 className="text-base font-bold text-white">Divergências de regularização</h3>
  <p>Homologação isolada. A decisão aprecia as evidências, sem quitação bancária ou extinção da obrigação.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void execute('list')}>Consultar regularizações</button>
  {error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status">{message}</p>}
  {page?.items.length===0&&<p>Nenhuma regularização pendente nesta página.</p>}
  {page?.items.map(i=><article key={i.offerId} className="rounded-xl border border-slate-800 p-3 space-y-2"><h4 className="text-base font-bold break-words">{i.title}</h4><p>{i.direction==='refund'?'Devolução':'Complemento'}: {money(i.amountMinor)}</p><p>Solicitação: {new Date(i.requestedAt).toLocaleString('pt-BR')}</p><button type="button" className={btn} disabled={busy} onClick={()=>{reset();setSelected(i);}}>Analisar regularização</button></article>)}
  {page?.nextCursor&&<button type="button" className={btn} disabled={busy} onClick={()=>void execute('list',page.nextCursor!)}>Próxima página de regularizações</button>}
  {selected&&<form className="space-y-3 rounded-xl border border-slate-700 p-3" onSubmit={e=>{e.preventDefault();void execute('decision');}}>
   <h4 className="text-base font-bold break-words">{selected.title}</h4><p className="break-all">Protocolo: {selected.offerId}</p>
   <p>{selected.direction==='refund'?'Devolução — profissional para contratante':'Complemento — contratante para profissional'}: {money(selected.amountMinor)}</p>
   {selected.statements.map((s,i)=><p key={i}>{s.role==='payer'?'Pagador':'Destinatário'}: {labels[s.statement]} · {new Date(s.recordedAt).toLocaleString('pt-BR')}</p>)}
   <div className="space-y-2"><h5 className="font-bold">Manifestações privadas</h5>{selected.notes.length===0&&<p>Nenhuma manifestação registrada.</p>}{selected.notes.map(n=><div key={n.id} className="rounded border border-slate-700 p-2"><p>{n.role==='worker'?'Profissional':'Contratante'} · {new Date(n.recordedAt).toLocaleString('pt-BR')}</p><p className="whitespace-pre-wrap break-words">{n.note}</p></div>)}<h5 className="font-bold">Anexos privados</h5>{selected.attachments.length===0&&<p>Nenhum anexo registrado.</p>}{selected.attachments.map(a=><HourlyAttachmentPreview key={selected.offerId+':'+a.id} user={user} offerId={selected.offerId} kind="fixed_adjustment" attachment={a} admin/>)}<p>Anexos não representam confirmação bancária.</p></div>
   <label className="block">Conclusão da análise<select className={field} value={outcome} disabled={busy} onChange={e=>{setOutcome(e.target.value);setConfirmed(false);}}><option value="">Selecione</option>{Object.entries(outcomes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label className="block">Fundamentação da regularização<textarea className={field} required minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a decisão fundamentada. A restrição deste caso será removida, sem quitação.</label>
   <button type="submit" className={btn} disabled={busy||!Object.hasOwn(outcomes,outcome)||!confirmed||reason.trim().length<10}>Registrar decisão da regularização</button>{' '}<button type="button" className={btn} disabled={busy} onClick={reset}>Voltar</button>
  </form>}
 </section>;
}
