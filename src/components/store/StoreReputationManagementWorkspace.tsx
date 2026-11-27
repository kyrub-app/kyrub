import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {storeReputationCandidateEnabled} from '../../utils/storeReputationCandidate';
import {submitStoreReviewReport} from '../../utils/storeReviewReports';
import type {SocialReportReason} from '../../utils/socialReports';
import FreelaReputationPanel from '../modals/FreelaReputationPanel';
import {StoreReputationWorkspace} from './StoreReputationWorkspace';
type Moment={storeId:string;reviewId:string;authorName:string;content:string;rating:number;createdAtIso:string};
type Contract={offerId:string;completedAt:string;mean:number;contestationPending:boolean};
type View={legacyStoreId:string;canonicalStoreId:string;owner:boolean;moments:Moment[];momentsTruncated:boolean;contracts:Contract[];contractsTruncated:boolean};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const valid=(v:unknown,storeId:string,uid:string):v is View=>{
 if(!v||typeof v!=='object')return false;
 const x=v as View;
 return Object.keys(x).length===7&&x.legacyStoreId===storeId&&id(x.canonicalStoreId)&&x.canonicalStoreId!==storeId&&x.owner===(uid===storeId)&&typeof x.momentsTruncated==='boolean'&&typeof x.contractsTruncated==='boolean'&&
 Array.isArray(x.moments)&&x.moments.length<=40&&x.moments.every(m=>m&&Object.keys(m).length===6&&[storeId,x.canonicalStoreId].includes(m.storeId)&&id(m.reviewId)&&typeof m.authorName==='string'&&typeof m.content==='string'&&Number.isInteger(m.rating)&&m.rating>=1&&m.rating<=5&&typeof m.createdAtIso==='string')&&
 Array.isArray(x.contracts)&&x.contracts.length<=20&&(x.owner||x.contracts.length===0&&!x.contractsTruncated)&&x.contracts.every(c=>c&&Object.keys(c).length===4&&id(c.offerId)&&typeof c.completedAt==='string'&&typeof c.mean==='number'&&Number.isFinite(c.mean)&&c.mean>=1&&c.mean<=5&&typeof c.contestationPending==='boolean');
};
const reasons:Record<SocialReportReason,string>={spam:'Spam',abuse:'Abuso ou ofensa',fraud:'Fraude',unsafe:'Conteúdo inseguro',other:'Outro motivo'};
const btn='min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-200 disabled:opacity-50';
export function StoreReputationManagementWorkspace({legacyStoreId}:{legacyStoreId:string}){
 const [user,setUser]=useState(auth.currentUser),[view,setView]=useState<View|null>(null),[tab,setTab]=useState<'professional'|'moments'>('professional'),[selected,setSelected]=useState(''),[report,setReport]=useState<Moment|null>(null),[reason,setReason]=useState<SocialReportReason>('spam'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const stop=onAuthStateChanged(auth,next=>{pending.current?.abort();pending.current=null;setUser(next);setView(null);setSelected('');setReport(null);setBusy(false);setError('');setMessage('');});
  return()=>{stop();pending.current?.abort();pending.current=null;};
 },[legacyStoreId]);
 async function load(){
  if(!user||auth.currentUser!==user||pending.current||!storeReputationCandidateEnabled())return;
  const ctl=new AbortController();pending.current=ctl;setBusy(true);setError('');setMessage('');setView(null);setSelected('');setReport(null);
  const live=()=>pending.current===ctl&&!ctl.signal.aborted&&auth.currentUser===user;
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const r=await fetch('/api/freelance/workspace?view=reputation_management&storeId='+encodeURIComponent(legacyStoreId),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctl.signal});
   const v=await r.json();if(!live())return;
   if(!r.ok||!valid(v,legacyStoreId,user.uid))throw Error('Consulta gerencial indisponível ou não autorizada.');
   setView(v);
  }catch(e){if(live())setError(e instanceof Error?e.message:'Consulta indisponível.');}
  finally{if(pending.current===ctl){if(live())setBusy(false);pending.current=null;}}
 }
 async function sendReport(){
  if(!view||!report||!user||auth.currentUser!==user||pending.current||!storeReputationCandidateEnabled())return;
  if(!view.moments.some(m=>m.storeId===report.storeId&&m.reviewId===report.reviewId))return;
  const ctl=new AbortController();pending.current=ctl;setBusy(true);setError('');setMessage('');
  const live=()=>pending.current===ctl&&!ctl.signal.aborted&&auth.currentUser===user;
  try{
   // Recheck current management authority immediately before using the existing
   // report workflow (public review reporting remains independently authorized).
   const token=await user.getIdToken(true);if(!live())return;
   const r=await fetch('/api/freelance/workspace?view=reputation_management&storeId='+encodeURIComponent(legacyStoreId),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctl.signal});
   const fresh=await r.json();if(!live())return;
   if(!r.ok||!valid(fresh,legacyStoreId,user.uid)||!fresh.moments.some(m=>m.storeId===report.storeId&&m.reviewId===report.reviewId))throw Error('Vínculo ou avaliação não confirmados.');
   const result=await submitStoreReviewReport(report.storeId,report.reviewId,reason);
   if(live()){setMessage(result==='already_reported'?'Denúncia já registrada.':'Denúncia encaminhada à moderação.');setReport(null);}
  }catch(e){if(live())setError(e instanceof Error?e.message:'Não foi possível encaminhar a denúncia.');}
  finally{if(pending.current===ctl){if(live())setBusy(false);pending.current=null;}}
 }
 if(!user||auth.currentUser!==user||!storeReputationCandidateEnabled())return null;
 return <section aria-label="Gestão de Reputações" className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
  <h3 className="text-base font-bold text-white">Gestão das avaliações</h3>
  <p className="text-slate-400">Reputações profissionais e Momentos dos consumidores são origens distintas. Não é permitido editar notas de terceiros.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void load()}>{busy?'Consultando…':'Consultar avaliações'}</button>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {view&&<><div role="group" aria-label="Origem das avaliações" className="flex flex-wrap gap-2"><button type="button" className={btn} aria-pressed={tab==='professional'} disabled={busy} onClick={()=>{setTab('professional');setReport(null);}}>Reputações profissionais</button><button type="button" className={btn} aria-pressed={tab==='moments'} disabled={busy} onClick={()=>{setTab('moments');setSelected('');}}>Momentos</button></div>
   {tab==='professional'?<>
    <StoreReputationWorkspace legacyStoreId={legacyStoreId}/>
    {view.owner?<><h4 className="font-bold">Avaliações dos contratos</h4>{view.contractsTruncated&&<p>Consulta limitada aos primeiros 20 contratos; não representa o histórico completo.</p>}{!view.contracts.length&&<p>Nenhuma avaliação bilateral encontrada nesta consulta.</p>}
     {view.contracts.map(c=><div key={c.offerId} className="rounded-xl border border-slate-700 p-3"><p>Contrato {c.offerId}</p><p>Média: {c.mean.toLocaleString('pt-BR',{maximumFractionDigits:2})} / 5{c.contestationPending?' · Contestação pendente':''}</p><button className={btn} type="button" onClick={()=>setSelected(old=>old===c.offerId?'':c.offerId)}>Consultar avaliação e contestação</button>{selected===c.offerId&&<FreelaReputationPanel key={c.offerId} user={user} offerId={c.offerId} role="requester"/>}</div>)}</>:<p>Contestações de contratos são reservadas ao titular autorizado, conforme o fluxo atual.</p>}
   </>:<>
    <h4 className="font-bold">Momentos dos consumidores</h4>{view.momentsTruncated&&<p>Consulta limitada a 20 avaliações por identidade de loja. Não é o histórico completo.</p>}{!view.moments.length&&<p>Nenhum Momento publicado encontrado nesta consulta.</p>}
    {view.moments.map(m=><article key={m.storeId+':'+m.reviewId} className="space-y-2 rounded-xl border border-slate-700 p-3"><p className="font-bold">{m.authorName}</p><p className="text-amber-300">{'★'.repeat(m.rating)}{'☆'.repeat(5-m.rating)}</p><p className="whitespace-pre-wrap break-words">{m.content}</p><button type="button" className={btn} disabled={busy||m.reviewId===user.uid} onClick={()=>{setReport(m);setReason('spam');}}>Denunciar à moderação</button></article>)}
    {report&&<div className="space-y-2 rounded-xl border border-slate-700 p-3"><p>Denunciar avaliação de {report.authorName}?</p><label className="block">Motivo<select value={reason} onChange={e=>setReason(e.target.value as SocialReportReason)} className="block w-full rounded-lg bg-slate-950 p-2">{Object.entries(reasons).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label><button type="button" className={btn} disabled={busy} onClick={()=>void sendReport()}>Confirmar denúncia</button><button type="button" className={btn} disabled={busy} onClick={()=>setReport(null)}>Cancelar</button></div>}
   </>}
  </>}
 </section>;
}
