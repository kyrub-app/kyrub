import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Proposal={id:string;recognizedExcessMs:number;proposedBy:'worker'|'requester';status:'pending'|'accepted'|'declined'|'withdrawn'};
type Note={id:string;role:'worker'|'requester';note:string;recordedAt:string};
type Item={evidenceDigest:string;notes:Note[];offerId:string;title:string;sourceDigest:string;requestedAt:string;authorizedMinor:number;hourlyRateMinor:number;recordedMs:number;excessMs:number;proposalDigest:string;proposal:Proposal|null;bankVerified:false};
type Page={items:Item[];nextCursor:string|null};
const endpoint='/api/admin/freelance-financial-review';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50';
const field='mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const nonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const money=(v:number|null)=>v===null?'Indefinido':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const duration=(v:number|null)=>v===null?'Sem registro':Math.floor(v/60000)+' min '+Math.floor(v/1000)%60+' s';
const seconds=(v:string)=>/^\d{1,8}$/.test(v.trim())?Number(v.trim())*1000:null;
const labels={pending:'Pendente',accepted:'Aceita',declined:'Recusada',withdrawn:'Retirada'};
const errors:Record<string,string>={second_factor_required:'Entre com autenticação multifator para consultar excedentes.',reauthentication_required:'Renove sua sessão com autenticação multifator.',FORBIDDEN:'Acesso administrativo não autorizado.',FREELANCE_FINANCIAL_REVIEW_CONFLICT:'A análise mudou. Consulte novamente antes de decidir.',FREELANCE_VARIABLE_PAYMENT_CONFLICT:'A base financeira mudou. Consulte novamente antes de decidir.'};
function validPage(v:unknown):v is Page{
 if(!v||typeof v!=='object')return false;
 const p=v as Page;
 return Array.isArray(p.items)&&p.items.length<=20&&(p.nextCursor===null||id(p.nextCursor))&&p.items.every(i=>i&&id(i.offerId)&&typeof i.title==='string'&&i.title.length<=120&&typeof i.sourceDigest==='string'&&/^[a-f0-9]{64}$/.test(i.sourceDigest)&&typeof i.requestedAt==='string'&&Number.isFinite(Date.parse(i.requestedAt))&&nonnegative(i.authorizedMinor)&&nonnegative(i.hourlyRateMinor)&&i.hourlyRateMinor>0&&nonnegative(i.recordedMs)&&nonnegative(i.excessMs)&&i.excessMs>0&&i.recordedMs>=i.excessMs&&/^[a-f0-9]{64}$/.test(i.proposalDigest)&&/^[a-f0-9]{64}$/.test(i.evidenceDigest)&&/^[a-f0-9]{64}$/.test(i.proposalDigest)&&Array.isArray(i.notes)&&i.notes.length<=4&&i.notes.every(n=>id(n.id)&&['worker','requester'].includes(n.role)&&typeof n.note==='string'&&n.note.length>=10&&n.note.length<=500&&typeof n.recordedAt==='string')&&i.bankVerified===false&&(i.proposal===null||i.proposal&&id(i.proposal.id)&&nonnegative(i.proposal.recognizedExcessMs)&&i.proposal.recognizedExcessMs<=i.excessMs&&['worker','requester'].includes(i.proposal.proposedBy)&&Object.hasOwn(labels,i.proposal.status)));
}
export default function AdminFreelanceExcessReview({user}:{user:User}){
 const [full,setFull]=useState(false);
 const [page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState<Item|null>(null),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 const reset=()=>{setSelected(null);setFull(false);setAmount('');setReason('');setConfirmed(false);};
 async function execute(kind:'list'|'decision',cursor?:string){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const minor=full?selected?.excessMs??null:seconds(amount);
  if(kind==='decision'&&(!selected||minor===null||minor>selected.excessMs||reason.trim().length<10||!confirmed))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');
  if(kind==='list'){reset();setPage(null);}
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const body=kind==='decision'?{action:'decide_hourly_excess',offerId:selected!.offerId,sourceDigest:selected!.sourceDigest,expectedRequestedAt:selected!.requestedAt,evidenceDigest:selected!.evidenceDigest,proposalDigest:selected!.proposalDigest,recognizedExcessMs:minor,reason:reason.trim(),confirmed:true}:null;
   const q=body?'':'?view=hourly_excess'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
   const r=await fetch(endpoint+q,{method:body?'POST':'GET',cache:'no-store',signal:ctl.signal,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const v=await r.json();if(!live())return;
   if(!r.ok)throw Error(errors[v?.code]??'Operação não confirmada.');
   if(kind==='list'){if(!validPage(v))throw Error('Resposta da fila não confirmada.');setPage(v);}
   else{if(v?.status!=='resolved_administratively'||v.bankVerified!==false)throw Error('Decisão não confirmada.');reset();setPage(null);setMessage('Decisão de excedente registrada. Consulte novamente.');}
  }catch(e){if(live()){setError(e instanceof Error?e.message:'Consulta indisponível.');reset();setPage(null);}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 const minor=full?selected?.excessMs??null:seconds(amount);
 return <section id="admin-freelance-excess-review" className="space-y-3 border-t border-slate-700 pt-3">
  <h3 className="text-base font-bold text-white">Excedentes por jornada</h3>
  <p>Homologação isolada. A decisão reconhece somente tempo adicional registrado, preservando a parcela autorizada. Não comprova pagamento.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void execute('list')}>Consultar excedentes</button>
  {error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status">{message}</p>}
  {page?.items.length===0&&<p>Nenhum excedente pendente nesta página.</p>}
  {page?.items.map(i=><article key={i.offerId} className="rounded-xl border border-slate-800 p-3 space-y-2"><h4 className="text-base font-bold break-words">{i.title}</h4><p>Parcela autorizada: {money(i.authorizedMinor)} · Excedente: {duration(i.excessMs)}</p><p>Solicitação: {new Date(i.requestedAt).toLocaleString('pt-BR')}</p><button type="button" className={btn} disabled={busy} onClick={()=>{reset();setSelected(i);}}>Analisar excedente</button></article>)}
  {page?.nextCursor&&<button type="button" className={btn} disabled={busy} onClick={()=>void execute('list',page.nextCursor!)}>Próxima página de excedentes</button>}
  {selected&&<form className="space-y-3 rounded-xl border border-slate-700 p-3" onSubmit={e=>{e.preventDefault();void execute('decision');}}>
   <h4 className="text-base font-bold break-words">{selected.title}</h4><p className="break-all">Protocolo: {selected.offerId}</p>
   <p>Tempo registrado: {duration(selected.recordedMs)}</p><p>Excedente registrado: {duration(selected.excessMs)}</p><p>Parcela autorizada: {money(selected.authorizedMinor)} · Valor por hora: {money(selected.hourlyRateMinor)}</p>
   <p>Proposta corrente: {selected.proposal?duration(selected.proposal.recognizedExcessMs)+' · '+labels[selected.proposal.status]+' · '+(selected.proposal.proposedBy==='worker'?'Profissional':'Contratante'):'Nenhuma'}</p>
   <div className="space-y-2"><h5 className="font-bold">Manifestações privadas</h5>{selected.notes.length===0&&<p>Nenhuma manifestação registrada.</p>}{selected.notes.map(n=><div key={n.id} className="rounded border border-slate-700 p-2"><p>{n.role==='worker'?'Profissional':'Contratante'} · {new Date(n.recordedAt).toLocaleString('pt-BR')}</p><p className="whitespace-pre-wrap break-words">{n.note}</p></div>)}<p>Anexos ainda indisponíveis nesta etapa. Não representam confirmação bancária.</p></div>
   <label className="block">Segundos adicionais reconhecidos<input className={field} inputMode="numeric" value={amount} disabled={busy||full} onChange={e=>{setAmount(e.target.value);setConfirmed(false);}}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={full} disabled={busy} onChange={e=>{setFull(e.target.checked);setConfirmed(false);}}/>Reconhecer todo o excedente registrado</label>
   {minor!==null&&minor<=selected.excessMs&&<p>Total reconhecido: {money(Number((BigInt(selected.hourlyRateMinor)*BigInt(selected.recordedMs-selected.excessMs+minor)+1800000n)/3600000n))}</p>}
   <label className="block">Fundamentação do excedente<textarea className={field} required minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
   <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo o tempo adicional e a decisão fundamentada. A restrição deste caso será removida, sem quitação.</label>
   <button type="submit" className={btn} disabled={busy||!confirmed||minor===null||minor>selected.excessMs||reason.trim().length<10}>Registrar decisão de excedente</button>{' '}<button type="button" className={btn} disabled={busy} onClick={reset}>Voltar</button>
  </form>}
 </section>;
}
