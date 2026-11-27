import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {storeReputationCandidateEnabled} from '../../utils/storeReputationCandidate';
import {validVerifiedReputationView,type VerifiedReputationView} from '../modals/verifiedReputationView';
import {reputationCriteria,reputationCriterionDescriptions} from '../../../shared/freelanceReputationCriteria';
const kind='store_requester';
const format=(n:number)=>n.toLocaleString('pt-BR',{maximumFractionDigits:2});
export function StoreReputationWorkspace({legacyStoreId}:{legacyStoreId:string}){
 const [user,setUser]=useState(auth.currentUser);
 const [data,setData]=useState<VerifiedReputationView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<AbortController|null>(null);
 useEffect(()=>{
  const stop=onAuthStateChanged(auth,next=>{
   pending.current?.abort();pending.current=null;setData(null);setBusy(false);setError('');setUser(next);
  });
  return()=>{stop();pending.current?.abort();pending.current=null;};
 },[legacyStoreId]);
 async function load(){
  if(!user||auth.currentUser!==user||pending.current||!storeReputationCandidateEnabled())return;
  const ctl=new AbortController();pending.current=ctl;setBusy(true);setData(null);setError('');
  const live=()=>pending.current===ctl&&!ctl.signal.aborted&&auth.currentUser===user;
  try{
   const token=await user.getIdToken(true);if(!live())return;
   const r=await fetch('/api/freelance/workspace?view=reputation_team&storeId='+encodeURIComponent(legacyStoreId),{method:'GET',cache:'no-store',headers:{authorization:'Bearer '+token},signal:ctl.signal});
   const v=await r.json();if(!live())return;
   if(!r.ok||!v||typeof v!=='object'||v.legacyStoreId!==legacyStoreId)throw Error('Consulta indisponível ou vínculo não autorizado.');
   const {legacyStoreId:scope,...projection}=v;
   if(typeof projection.subject?.id!=='string'||!validVerifiedReputationView(projection,kind,projection.subject.id))throw Error('Indicadores não confirmados.');
   setData(projection);
  }catch(e){if(live())setError(e instanceof Error?e.message:'Consulta indisponível.');}
  finally{if(pending.current===ctl){if(live())setBusy(false);pending.current=null;}}
 }
 if(!user||auth.currentUser!==user||!storeReputationCandidateEnabled())return null;
 const p=data?.projection;
 return <section aria-label="Reputações" className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200">
  <h2 className="text-base font-bold text-white">Reputações</h2>
  <p className="text-sm text-slate-400">Indicadores da empresa como contratante de Frilas. A equipe pode acompanhar e melhorar as relações profissionais. Consulta de homologação.</p>
  <button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold disabled:opacity-50">{busy?'Conferindo…':'Consultar reputações'}</button>
  {busy&&<p role="status">Verificando registros…</p>}{error&&<p role="alert">{error}</p>}
  {data&&data.state!=='verified_snapshot'&&<p role="status">Indicadores em conferência. Nenhum total parcial será exibido.</p>}
  {data?.state==='verified_snapshot'&&p&&<div className="space-y-3">
   <div className="grid grid-cols-2 gap-2"><div className="rounded-xl border border-slate-700 p-3"><p>Experiência</p><strong className="text-lg">{format(p.completedContracts)}</strong><p>Contratações concluídas</p></div><div className="rounded-xl border border-slate-700 p-3"><p>Reputação</p><strong className="text-lg text-amber-300">{p.aggregate.mean===null?'Sem avaliações':format(p.aggregate.mean)+' ★'}</strong><p>{format(p.aggregate.ratingCount)} avaliações liberadas</p></div></div>
   <dl className="space-y-2">{Object.entries(reputationCriteria(kind)).map(([k,label])=><div key={k} className="rounded-lg border border-slate-800 p-2"><div className="flex justify-between gap-2"><dt className="font-bold">{label}</dt><dd>{p.aggregate.criteria[k].mean===null?'—':format(p.aggregate.criteria[k].mean!)+' / 5'}</dd></div><dd className="text-slate-400">{reputationCriterionDescriptions(kind)[k]}</dd><dd className="text-slate-400">{format(p.aggregate.criteria[k].count)} avaliações aplicáveis</dd></div>)}</dl>
  </div>}
 </section>;
}
