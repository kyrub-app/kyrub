import {reputationCriteria} from '../../../shared/freelanceReputationCriteria';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {subjects,validReputationContestPage,type Page} from './reputationContestPage';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50';
const errors:Record<string,string>={second_factor_required:'Entre com autenticação multifator.',reauthentication_required:'Renove sua sessão com autenticação multifator.',AUTH_REQUIRED:'Entre novamente para continuar.',FORBIDDEN:'Consulta não autorizada ou indisponível.',FREELANCE_FORBIDDEN:'Consulta não autorizada ou indisponível.',FREELANCE_REPUTATION_CONFLICT:'A integridade da contestação não foi confirmada.'};
export default function AdminFreelanceReputationContests({user}:{user:User}){
 const [page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{setPage(null);setError('');setBusy(false);return()=>{active.current?.abort();active.current=null;};},[user.uid]);
 async function load(cursor?:string){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const ctl=new AbortController();active.current=ctl;
  const live=()=>active.current===ctl&&!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setPage(null);setBusy(true);setError('');
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const response=await fetch('/api/admin/freelance-financial-review?view=reputation_contests'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{method:'GET',cache:'no-store',signal:ctl.signal,headers:{authorization:'Bearer '+token}});
   const data=await response.json().catch(()=>null);if(!live())return;
   if(!response.ok)throw Error(errors[data?.code]??'Consulta de contestações indisponível.');
   if(!validReputationContestPage(data))throw Error('Resposta da fila não confirmada.');
   setPage(data);
  }catch(e){if(live()){setPage(null);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(active.current===ctl){if(live())setBusy(false);active.current=null;}}
 }
 if(auth.currentUser?.uid!==user.uid)return null;
 return <section id="admin-freelance-reputation-contests" className="space-y-3 border-t border-slate-700 pt-3">
  <h3 className="text-base font-bold text-white">Contestações de Reputações</h3>
  <p>Homologação isolada. Consulta privada, sem alteração de avaliação ou decisão administrativa.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void load()}>Consultar contestações</button>
  {busy&&<p role="status">Consultando servidor…</p>}
  {error&&<p role="alert" className="text-amber-300">{error}</p>}
  {page?.items.length===0&&<p>Nenhuma contestação pendente nesta página.</p>}
  {page?.items.map(i=><article key={i.caseId} className="space-y-2 rounded-xl border border-slate-800 p-3">
   <h4 className="text-base font-bold text-white">{subjects[i.subjectKind]}</h4>
   <p>Média original: {i.mean.toLocaleString('pt-BR',{maximumFractionDigits:2})}/5</p>
   <dl>{Object.entries(reputationCriteria(i.subjectKind)).map(([k,label])=><div key={k} className="flex justify-between gap-2"><dt>{label}</dt><dd>{i.scores[k]===null?'Não se aplica':i.scores[k]+'/5'}</dd></div>)}</dl>
   <p>Avaliador: {i.ratingRole==='requester'?'Contratante':'Profissional'}</p>
   <p className="break-all">Contrato: {i.offerId}</p>
   <p className="break-all">Protocolo: {i.caseId}</p>
   <p>Solicitação: {new Date(i.requestedAt).toLocaleString('pt-BR')}</p>
   <p className="text-amber-300">Pendente de análise</p>
   <p className="font-bold">Justificativa privada</p><p className="whitespace-pre-wrap break-words">{i.reason}</p>
  </article>)}
  {page?.nextCursor&&<button type="button" className={btn} disabled={busy} onClick={()=>void load(page.nextCursor!)}>Próxima página de contestações</button>}
 </section>;
}
