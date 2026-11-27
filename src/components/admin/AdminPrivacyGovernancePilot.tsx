import {useRef,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {hasAdminPermission,type AdminProfile} from '../../utils/adminControlPlane';
import AdminAccordionSection from './AdminAccordionSection';
import {PRIVACY_CONTEXTS,PRIVACY_RIGHTS} from '../../../shared/privacyRights';
import {PRIVACY_ASSESSMENT_FINDINGS,type PrivacyAssessmentFinding} from '../../../shared/privacyRightsAssessment';
import {PRIVACY_RESPONSE_MESSAGES} from '../../../shared/privacyRightsResponse';
import {privacyAdminActions,type PrivacyAdminAdapter,type PrivacyAdminItem} from '../../../shared/privacyAdminWorkspace';
const btn='min-h-10 rounded-lg border border-slate-700 px-3 py-2 text-sm disabled:opacity-50';
function PrivacyQueue({adapter}:{adapter?:PrivacyAdminAdapter}){
 const [rows,setRows]=useState<PrivacyAdminItem[]>([]),[loaded,setLoaded]=useState(false),[more,setMore]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [selected,setSelected]=useState<string|null>(null),[finding,setFinding]=useState<PrivacyAssessmentFinding>('additional-verification'),[reason,setReason]=useState('');
 const lock=useRef(false);
 function reset(){setSelected(null);setReason('');setFinding('additional-verification');}
 async function run(action?:()=>Promise<unknown>){
  if(!adapter||lock.current)return;
  lock.current=true;setBusy(true);setNotice('');setRows([]);setLoaded(false);setMore(false);reset();
  let committed=false;
  try{
   if(action){await action();committed=true;}
   const r=await adapter.list();
   if(r.simulation!==true||!Array.isArray(r.items)||r.items.length>50||r.items.some(x=>x.identityStatus!=='pending-verification'||x.actionStatus!=='not-executed'))throw Error('UNCONFIRMED');
   setRows(r.items);setMore(r.hasMore);setLoaded(true);
   if(committed)setNotice('Operação de homologação registrada. Nenhum direito foi atendido automaticamente.');
  }catch{setNotice(committed?'Operação registrada, mas a atualização da fila falhou. Consulte novamente.':'Não foi possível confirmar a operação. Consulte novamente antes de repetir.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section aria-label="Fila de direitos dos titulares" className="space-y-3">
  <p className="text-xs text-amber-200">Homologação isolada. Não utilize dados reais. As permissões são verificadas novamente pelo servidor.</p>
  <button type="button" className={btn} disabled={!adapter||busy} onClick={()=>void run()}>Consultar fila</button>
  {!adapter&&<p className="text-xs">Canal administrativo indisponível nesta prévia.</p>}
  {loaded&&rows.length===0&&<p className="text-sm">Nenhuma solicitação na fila consultada.</p>}
  {more&&<p className="text-xs text-amber-200">Exibindo até 50 solicitações recentes. A consulta não representa a fila completa.</p>}
  {rows.map(item=>{
   const a=privacyAdminActions(item);
   return <article key={item.protocol} className="space-y-2 rounded-xl border border-slate-700 p-3">
    <h3 className="text-sm font-bold">{PRIVACY_RIGHTS[item.draft.right]}</h3><p className="text-xs text-slate-300">{PRIVACY_CONTEXTS[item.draft.context]}</p>
    <p className="break-all text-xs">Protocolo: {item.protocol}</p><p className="text-xs">{new Date(item.receivedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p>
    <p className="text-sm">{item.triageStatus==='pending-review'?'Aguardando triagem':'Verificação requerida'} · {item.evidenceStatus==='awaiting-evidence'?'Aguardando comprovação':'Controle de credencial comprovado'}</p>
    {item.assessmentFinding&&<p className="text-sm">{PRIVACY_ASSESSMENT_FINDINGS[item.assessmentFinding]}</p>}
    {item.responseStatus&&<p className="text-xs">Aviso: {item.responseStatus==='reviewed'?'revisado':'rascunho'}</p>}
    <div className="flex flex-wrap gap-2">
     {a.triage&&<button type="button" className={btn} disabled={busy||!adapter} onClick={()=>void run(()=>adapter!.triage({protocol:item.protocol,expectedRevision:0}))}>Solicitar verificação</button>}
     {a.assess&&<button type="button" className={btn} disabled={busy||!adapter} onClick={()=>{reset();setSelected(item.protocol);}}>Registrar parecer</button>}
     {a.prepare&&<button type="button" className={btn} disabled={busy||!adapter} onClick={()=>void run(()=>adapter!.prepareResponse({protocol:item.protocol,expectedAssessmentRevision:item.assessmentRevision}))}>Preparar aviso</button>}
    </div>
    {selected===item.protocol&&a.assess&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();if(reason.trim())void run(()=>adapter!.assess({protocol:item.protocol,expectedRevision:item.assessmentRevision,finding,reason:reason.trim()}));}}>
     <label className="block text-sm">Parecer<select className={btn+' block w-full bg-slate-950'} value={finding} disabled={busy} onChange={e=>setFinding(e.target.value as PrivacyAssessmentFinding)}>{Object.entries(PRIVACY_ASSESSMENT_FINDINGS).map(([k,v])=><option key={k} value={k} disabled={k==='ready-for-fulfillment-review'&&item.evidenceStatus==='awaiting-evidence'}>{v}</option>)}</select></label>
     <label className="block text-sm">Justificativa fictícia (sem dados pessoais)<textarea className={btn+' block w-full bg-slate-950'} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
     <button className={btn} type="submit" disabled={busy||!adapter||!reason.trim()}>Confirmar parecer</button><button className={btn} type="button" onClick={reset}>Cancelar</button>
    </form>}
    {a.review&&item.assessmentFinding&&<div className="space-y-2 rounded-lg bg-slate-950 p-3"><p className="text-sm">{PRIVACY_RESPONSE_MESSAGES[item.assessmentFinding]}</p><p className="text-xs">Revisão exige operador diferente do preparador.</p>{(['approve','return'] as const).map(decision=><button key={decision} type="button" className={btn} disabled={busy||!adapter} onClick={()=>void run(()=>adapter!.reviewResponse({protocol:item.protocol,expectedAssessmentRevision:item.assessmentRevision,expectedResponseRevision:item.responseRevision!,decision}))}>{decision==='approve'?'Aprovar aviso':'Devolver para revisão'}</button>)}</div>}
   </article>;
  })}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>;
}
// Explicit isolated harness; not mounted in the production Control Plane.
export function AdminPrivacyGovernancePilot({profile,uid,adapter}:{profile:AdminProfile|null;uid:string;adapter?:PrivacyAdminAdapter}){
 if(!profile||profile.uid!==uid||!hasAdminPermission(profile,'manage_compliance'))return null;
 return <AdminAccordionSection id="admin-privacy-governance-pilot" title="Governança e Compliance" description="Direitos dos titulares e prontidão de privacidade — homologação." icon={ShieldCheck}>
  <PrivacyQueue key={uid+':'+profile.role} adapter={adapter}/>
  <div className="mt-4 grid gap-2 sm:grid-cols-2">{['Documentos jurídicos','Consentimentos','Inventário de dados','Retenção e descarte','Fornecedores e operadores','Incidentes de segurança','Auditoria de conformidade'].map(label=><div key={label} className="rounded-xl border border-slate-700 p-3"><h3 className="text-sm font-bold">{label}</h3><p className="text-xs text-slate-400">Integração operacional pendente</p></div>)}</div>
 </AdminAccordionSection>;
}
