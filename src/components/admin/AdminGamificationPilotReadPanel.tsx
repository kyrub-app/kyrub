import {useEffect,useState} from 'react';
import {requestGamificationPilot,type PilotQuery,type PilotSession,type SuspicionStatus} from '../../utils/gamificationAdminPilotClient';

type RecordData=Record<string,unknown>;
const obj=(value:unknown):RecordData=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_PILOT_RESPONSE');
 return value as RecordData;
};
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value.toLocaleString('pt-BR'):'Indisponível';
const text=(value:unknown)=>typeof value==='string'?value:'Indisponível';
const outcome=(value:unknown)=>value==='resolved'?'Resolvido':value==='inconclusive'?'Inconclusivo':value==='referred_for_review'?'Encaminhado para revisão':'—';
const findingLabels:Record<string,string>={INVALID_COUNTER:'Contador inválido',ORPHAN_RECEIPTS:'Recibos sem contador',COUNTER_BELOW_OBSERVED:'Contador abaixo do observado',COUNTER_RECEIPT_MISMATCH:'Divergência entre contador e recibos',INVALID_RECEIPT:'Recibo inválido',SELF_SEED_RECEIPT:'Recibo de semeadura própria'};
function findings(value:unknown){
 const data=obj(value);
 return Array.isArray(data.findings)?data.findings.map(v=>typeof v==='string'?(findingLabels[v]??'Indício não reconhecido'):'Indício não reconhecido').join('; ')||'Nenhum indício identificado':'Indisponível';
}

/** Read-only local integration. Explicit refresh, no polling, no storage,
 * no fallback to real data. Remounts on session/area changes. */
export default function AdminGamificationPilotReadPanel({session,isCurrent,area}:{
 session:PilotSession;isCurrent:()=>boolean;area:'pitangas'|'semeadura'|'suspeitas';
}){
 const [status,setStatus]=useState<SuspicionStatus>('all');
 const [cursor,setCursor]=useState<string|undefined>();
 const [caseId,setCaseId]=useState<string|undefined>();
 const [revision,setRevision]=useState(0);
 const [result,setResult]=useState<{key:string;data:RecordData}|null>(null);
 const [failed,setFailed]=useState('');
 const key=JSON.stringify([session.uid,area,status,cursor,caseId,revision]);
 useEffect(()=>{
  const controller=new AbortController();
  const query:PilotQuery=area!=='suspeitas'?{operation:'snapshot'}:caseId?
   {operation:'case',caseId}:{operation:'cases',status,limit:20,afterCaseId:cursor};
  void requestGamificationPilot(query,session,isCurrent,controller.signal).then(value=>{
   if(controller.signal.aborted||!isCurrent())return;
   const data=obj(value);
   const expected=query.operation==='snapshot'?'refreshed-accounts-only':query.operation==='cases'?'isolated-suspicion-cases':'isolated-suspicion-case-history';
   if(data.scope!==expected)throw Error('INVALID_PILOT_RESPONSE');
   setResult({key,data});
  }).catch(()=>{if(!controller.signal.aborted)setFailed(key);});
  return ()=>controller.abort();
 },[key,session,isCurrent,area,status,cursor,caseId]);
 const data=result?.key===key&&isCurrent()?result.data:null;
 const next=data&&typeof data.nextAfterCaseId==='string'?data.nextAfterCaseId:undefined;
 const rows=data&&Array.isArray(data.cases)?data.cases.filter(v=>v&&typeof v==='object') as RecordData[]:[];
 const metrics=data&&area!=='suspeitas'?(area==='pitangas'?data.reconciledEconomySubtotal:data.authorProjectionSubtotal):null;
 const values=metrics&&typeof metrics==='object'?metrics as RecordData:null;
 return <div className="mt-4 rounded-xl border border-slate-700 p-3 text-sm text-slate-300">
  <p>Homologação isolada · leitura somente · sem dados de produção.</p>
  <div className="mt-2 flex flex-wrap gap-2">
   <button type="button" className="rounded border border-slate-600 px-3 py-2" onClick={()=>setRevision(v=>v+1)}>Atualizar consulta</button>
   {area==='suspeitas'&&<><label className="sr-only" htmlFor="pilot-case-filter">Situação</label><select id="pilot-case-filter" className="rounded border border-slate-600 bg-slate-900 px-2" value={status} onChange={e=>{setStatus(e.target.value as SuspicionStatus);setCursor(undefined);setCaseId(undefined);}}>
    <option value="all">Todos</option><option value="open">Abertos</option><option value="closed">Encerrados</option>
   </select>{(caseId||cursor)&&<button type="button" onClick={()=>{setCaseId(undefined);setCursor(undefined);}}>Voltar à lista inicial</button>}</>}
  </div>
  {!data?<p className="mt-3" role="status">{failed===key?'Consulta indisponível. Nenhum valor inferido.':'Carregando consulta de homologação…'}</p>:
   area!=='suspeitas'?<div className="mt-3">
    <p>Subtotal das contas processadas · pode estar desatualizado. Cobertura global não verificada.</p>
    <p>Contas processadas: {count(data.refreshedAccounts)} · com {area==='pitangas'?'economia conciliada':'projeção pessoal'}: {count(area==='pitangas'?data.economyKnown:data.journeyKnown)}</p>
    <p>Última atualização: {text(data.updatedAt)}</p>
    <dl className="mt-2 grid gap-2 sm:grid-cols-3">{(area==='pitangas'?[['Créditos brutos','credits'],['Débitos brutos','debits'],['Saldo conciliado','balance']]:[['Sementes','seeds'],['Pitangueiras','pitangueiras'],['Bosques pessoais','bosques']]).map(([label,k])=><div key={k}><dt>{label}</dt><dd className="font-bold">{count(values?.[k])}</dd></div>)}</dl>
   </div>:caseId?<div className="mt-3">
    <p>Caso: {text(data.caseId)} · {data.status==='closed'?'Encerrado':'Aberto'}</p>
    <p>Abertura: {text(data.openedAt)} · responsável: {text(data.openedBy)}</p>
    <p>Evidência inicial: {data.openingEvidence&&typeof data.openingEvidence==='object'?findings(data.openingEvidence):'Indisponível'}</p>
    <p>Desfecho: {outcome(data.outcome)}</p>
    {data.closing&&typeof data.closing==='object'?<p>Encerramento: {text(data.closedAt)} · responsável: {text((data.closing as RecordData).closedBy)} · evidência final: {((data.closing as RecordData).evidence&&typeof (data.closing as RecordData).evidence==='object')?findings((data.closing as RecordData).evidence):'Indisponível'}</p>:null}
   </div>:<div className="mt-3">
    {Array.isArray(data.cases)?rows.length===0?<p>Nenhum caso nesta página.</p>:<ul className="space-y-2">{rows.map(row=><li key={text(row.caseId)}><button type="button" className="w-full rounded border border-slate-700 p-2 text-left" onClick={()=>{if(typeof row.caseId==='string')setCaseId(row.caseId);}}>{text(row.caseId)} · {row.status==='closed'?'Encerrado':'Aberto'} · {outcome(row.outcome)}</button></li>)}</ul>:<p>Resposta indisponível.</p>}
    {next&&<button type="button" className="mt-2 rounded border border-slate-600 px-3 py-2" onClick={()=>setCursor(next)}>Próxima página</button>}
    <p className="mt-2 text-slate-400">Ordenação por identificador. Indício não é confirmação de fraude.</p>
   </div>}
 </div>;
}
