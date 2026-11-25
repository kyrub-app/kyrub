import {useEffect,useRef,useState} from 'react';
import {requestGamificationPilot,submitGamificationPilotCase,type PilotSession,type PilotCaseCommand} from '../../utils/gamificationAdminPilotClient';

type Row=Record<string,unknown>;
const object=(value:unknown):Row|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:null;
const string=(value:unknown)=>typeof value==='string'?value:'Indisponível';
const labels:Record<string,string>={awaiting_acceptance:'Aguardando aceite',pending:'Em revisão',decided:'Decisão registrada',
 no_action:'Sem intervenção',insufficient_evidence:'Evidências insuficientes',requires_separate_corrective_review:'Avaliação corretiva separada'};
const label=(value:unknown)=>labels[string(value)]??'Indisponível';
const findingLabels:Record<string,string>={INVALID_COUNTER:'Contador inválido',ORPHAN_RECEIPTS:'Recibos sem contador',COUNTER_BELOW_OBSERVED:'Contador abaixo do observado',COUNTER_RECEIPT_MISMATCH:'Divergência entre contador e recibos',INVALID_RECEIPT:'Recibo inválido',SELF_SEED_RECEIPT:'Recibo de semeadura própria'};
function Evidence({title,value}:{title:string;value:unknown}){
 const data=object(value);
 const findings=data&&Array.isArray(data.findings)?data.findings.map(v=>findingLabels[string(v)]??'Indício não reconhecido'):null;
 return <div className="rounded border border-slate-700 p-2"><h4 className="font-semibold">{title}</h4>
 <p>Cobertura: {data?.coverage==='complete'?'Completa na consulta':data?.coverage==='partial'?'Parcial':'Indisponível'}</p>
 <p>{findings===null?'Indisponível':findings.length?findings.join('; '):'Nenhum indício nesta leitura'}</p></div>;
}

export default function AdminGamificationPilotEconomicPanel({session,isCurrent,referralWrites=false}:{
 session:PilotSession;isCurrent:()=>boolean;referralWrites?:boolean;
}){
 const [caseId,setCaseId]=useState<string>();
 const [cursor,setCursor]=useState<string>();
 const [revision,setRevision]=useState(0);
 const [result,setResult]=useState<{key:string;data:Row}|null>(null);
 const [failed,setFailed]=useState('');
 const [decision,setDecision]=useState<'no_action'|'insufficient_evidence'|'requires_separate_corrective_review'>('insufficient_evidence');
 const [reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const mutation=useRef<AbortController|null>(null);
 const pending=useRef<PilotCaseCommand|null>(null);
 const key=JSON.stringify([session.uid,caseId,cursor,revision]);
 useEffect(()=>{
  const controller=new AbortController();
  void requestGamificationPilot(caseId?{operation:'referral',caseId}:{operation:'referrals',limit:10,afterCaseId:cursor},session,isCurrent,controller.signal).then(value=>{
   if(controller.signal.aborted||!isCurrent())return;
   const data=object(value);
   if(!data||data.scope!==(caseId?'isolated-economic-referral':'isolated-economic-referrals'))throw Error('INVALID_PILOT_RESPONSE');
   setResult({key,data});
  }).catch(()=>{if(!controller.signal.aborted)setFailed(key);});
  return ()=>controller.abort();
 },[key,session,isCurrent,caseId,cursor]);
 useEffect(()=>()=>mutation.current?.abort(),[]);
 const data=result?.key===key&&isCurrent()?result.data:null;
 const reset=()=>{pending.current=null;setConfirmed(false);setReason('');setMessage('');};
 const submit=async()=>{
  if(!referralWrites||!caseId||!data||!confirmed||mutation.current||!isCurrent())return;
  if(data.status!=='awaiting_acceptance'&&data.status!=='pending')return;
  if(data.status==='pending'&&reason.trim().length<10)return;
  const command=pending.current??(data.status==='awaiting_acceptance'?{operation:'accept_referral',caseId,confirmed:true}:{operation:'decide_referral',caseId,decision,reason,confirmed:true});
  pending.current=command;
  const controller=new AbortController();mutation.current=controller;setBusy(true);setMessage('');
  try{
   await submitGamificationPilotCase(command,session,isCurrent,controller.signal);
   if(!controller.signal.aborted&&isCurrent()){reset();setRevision(v=>v+1);}
  }catch{
   if(!controller.signal.aborted&&isCurrent())setMessage('Resultado não confirmado. Consulte novamente antes de alterar a decisão.');
  }finally{if(!controller.signal.aborted){mutation.current=null;setBusy(false);}}
 };
 const end=object(data?.decision);
 return <div className="mt-4 space-y-3 rounded-xl border border-slate-700 p-3 text-sm text-slate-300">
  <p>Homologação isolada · encaminhamentos não alteram saldos nem bloqueiam contas.</p>
  <div className="flex flex-wrap gap-2">
   <button type="button" disabled={busy} onClick={()=>{reset();setRevision(v=>v+1);}}>Atualizar revisões</button>
   {(caseId||cursor)&&<button type="button" disabled={busy} onClick={()=>{reset();setCaseId(undefined);setCursor(undefined);}}>Voltar aos encaminhamentos</button>}
  </div>
  {!data?<p role="status">{failed===key?'Consulta indisponível. Nenhum valor inferido.':'Carregando revisões…'}</p>:caseId?<div className="space-y-2">
   <p>Caso: {string(data.caseId)} · {label(data.status)}</p>
   <p>Encaminhado por: {string(data.referredBy)} · {string(data.sourceClosedAt)}</p>
   {data.acceptedBy!==null&&<p>Aceite: {string(data.acceptedBy)} · {string(data.acceptedAt)}</p>}
   <Evidence title="Evidência inicial" value={data.openingEvidence}/><Evidence title="Evidência final" value={data.closingEvidence}/>
   {end&&<div><p>Decisão: {label(end.outcome)}</p><p>Justificativa: {string(end.reason)}</p><p>Responsável: {string(end.decidedBy)} · {string(end.decidedAt)}</p></div>}
   {referralWrites&&(data.status==='awaiting_acceptance'||data.status==='pending')&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void submit();}}>
    {data.status==='pending'&&<><label className="block">Decisão econômica<select className="block bg-slate-900" value={decision} disabled={busy} onChange={e=>{pending.current=null;setConfirmed(false);setDecision(e.target.value as typeof decision);}}><option value="no_action">Sem intervenção</option><option value="insufficient_evidence">Evidências insuficientes</option><option value="requires_separate_corrective_review">Avaliação corretiva separada</option></select></label>
    <label className="block">Justificativa<textarea className="block w-full rounded border border-slate-600 bg-slate-900 p-2" value={reason} minLength={10} maxLength={500} required disabled={busy} onChange={e=>{pending.current=null;setConfirmed(false);setReason(e.target.value);}}/></label></>}
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo esta decisão de revisão.</label>
    <button type="submit" disabled={!confirmed||busy} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-50">{data.status==='awaiting_acceptance'?'Aceitar encaminhamento':'Registrar decisão'}</button>
   </form>}{message&&<p role="alert">{message}</p>}
  </div>:<div>
   {!Array.isArray(data.rows)?<p>Resposta indisponível.</p>:data.rows.length===0?<p>Nenhum encaminhamento nesta página.</p>:<ul className="space-y-2">{data.rows.map(value=>{const row=object(value);return row&&typeof row.caseId==='string'?<li key={row.caseId}><button type="button" className="w-full rounded border border-slate-700 p-2 text-left" onClick={()=>{reset();setCaseId(row.caseId as string);}}>{row.caseId} · {label(row.status)}</button></li>:null;})}</ul>}
   {typeof data.nextAfterCaseId==='string'&&<button type="button" className="mt-2" onClick={()=>setCursor(data.nextAfterCaseId as string)}>Próxima página</button>}
   <p>Até 10 casos por página. Sem total global verificado.</p>
  </div>}
 </div>;
}
