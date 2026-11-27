import {ReputationSquarePreview,reputationSquareCandidateEnabled} from '../ReputationSquarePreview';
import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {reputationCriteria,reputationCriterionDescriptions} from '../../../shared/freelanceReputationCriteria';
import {freelaReputationCandidateEnabled} from './FreelaReputationPanel';
import {validVerifiedReputationView,type VerifiedReputationView} from './verifiedReputationView';
type Kind='professional'|'personal_requester';
const labels={professional:'Profissional',personal_requester:'Contratante pessoal'} as const;
const format=(n:number)=>n.toLocaleString('pt-BR',{maximumFractionDigits:2});
const button='min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold disabled:opacity-50';
export function personalReputationCandidateEnabled(){
 return freelaReputationCandidateEnabled()&&import.meta.env.VITE_KYRUB_FREELANCE_REPUTATION_INDEX_TEST_ONLY==='true';
}
export function PersonalReputationPanel({user,visibleIdentifier=null}:{user:User;visibleIdentifier?:string|null}){
 const [kind,setKind]=useState<Kind>('professional'),[data,setData]=useState<VerifiedReputationView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authorized,setAuthorized]=useState(auth.currentUser===user);
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const unsub=onAuthStateChanged(auth,next=>{
   const same=next===user;setAuthorized(same);
   if(!same){pending.current?.abort();pending.current=null;setData(null);setError('');setBusy(false);}
  });
  return()=>{pending.current?.abort();pending.current=null;unsub();};
 },[user]);
 function choose(next:Kind){
  pending.current?.abort();pending.current=null;setBusy(false);setData(null);setError('');setKind(next);
 }
 async function load(){
  if(pending.current||auth.currentUser!==user||!personalReputationCandidateEnabled())return;
  const ctl=new AbortController();pending.current=ctl;
  const live=()=>pending.current===ctl&&!ctl.signal.aborted&&auth.currentUser===user;
  setBusy(true);setData(null);setError('');
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const suffix=kind==='professional'?'professional':'personal';
   const r=await fetch('/api/freelance/workspace?view=reputation_verified_'+suffix,{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctl.signal});
   const v=await r.json();if(!live())return;
   if(!r.ok||!validVerifiedReputationView(v,kind,user.uid))throw Error('Indicadores indisponíveis. Tente novamente.');
   setData(v);
  }catch(e){if(live())setError(e instanceof Error?e.message:'Indicadores indisponíveis.');}
  finally{if(pending.current===ctl){if(live())setBusy(false);pending.current=null;}}
 }
 if(!authorized||auth.currentUser!==user||!personalReputationCandidateEnabled())return null;
 const p=data?.projection;
 return <section aria-label="Experiência e Reputações" className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
  <h3 className="text-base font-bold text-white">Experiência e Reputações</h3>
  <p className="text-sm text-slate-400">Consulta privada de homologação. Experiência registra contratos concluídos; Reputações consideram avaliações liberadas pelas duas partes.</p>
  <div className="flex flex-wrap gap-2" role="group" aria-label="Papel profissional">
   {(Object.keys(labels) as Kind[]).map(k=><button type="button" key={k} className={button+' '+(kind===k?'border-orange-500 text-orange-300':'text-slate-300')} aria-pressed={kind===k} onClick={()=>choose(k)}>{labels[k]}</button>)}
  </div>
  <button type="button" className={button} disabled={busy} onClick={()=>void load()}>{busy?'Conferindo indicadores…':data?'Atualizar indicadores':'Consultar indicadores'}</button>
  {busy&&<p role="status">Verificando registros…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}
  {data?.state==='repair_required'&&<p role="status">Indicadores em conferência. Nenhum total parcial será exibido.</p>}
  {data?.state==='requires_batched_audit'&&<p role="status">Histórico requer conferência adicional. Indicadores ainda indisponíveis.</p>}
  {data?.state==='verified_snapshot'&&p&&<div className="space-y-3">
   <div className="grid grid-cols-2 gap-2">
    <div className="rounded-xl border border-slate-700 p-3"><p>Experiência</p><strong className="block text-lg text-white">{format(p.completedContracts)}</strong><p className="text-slate-400">{kind==='professional'?'Serviços concluídos':'Contratações concluídas'}</p></div>
    <div className="rounded-xl border border-slate-700 p-3"><p>Reputação</p><strong className="block text-lg text-amber-300">{p.aggregate.mean===null?'Sem avaliações':format(p.aggregate.mean)+' ★'}</strong><p className="text-slate-400">{format(p.aggregate.ratingCount)} avaliações liberadas</p></div>
   </div>
   <dl className="space-y-2">{Object.entries(reputationCriteria(kind)).map(([key,label])=>{
    const c=p.aggregate.criteria[key];
    return <div key={key} className="rounded-lg border border-slate-800 p-2"><div className="flex justify-between gap-2"><dt className="font-bold text-white">{label}</dt><dd className="shrink-0 text-amber-300">{c.mean===null?'—':format(c.mean)+' / 5'}</dd></div><dd className="text-slate-400">{reputationCriterionDescriptions(kind)[key]}</dd><dd className="text-slate-400">{format(c.count)} avaliações aplicáveis</dd></div>;
   })}</dl>
   <p className="text-slate-400">Conferido nesta consulta. Não altera Cocares, Pitangas ou saldo de sementes.</p>
   {visibleIdentifier&&reputationSquareCandidateEnabled()&&<ReputationSquarePreview key={user.uid+':'+visibleIdentifier} user={user} identifier={visibleIdentifier}/>} 
  </div>}
 </section>;
}
