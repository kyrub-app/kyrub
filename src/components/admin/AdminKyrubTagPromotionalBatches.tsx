import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {isTagId,tagUrl} from '../../../shared/kyrubTagContract';
import AdminKyrubTagNfcWizard from './AdminKyrubTagNfcWizard';

type Unit={id:string;url:string;physicalStatus:'not_verified'|'readback_confirmed'|'readback_stale'};
type Batch={id:string;model:'adesivo';urlMode?:'pilot'|'permanent';count:number;units:Unit[]};
type Readiness={
 isolation:'emulator'|'isolated-project'|'unsafe';
 productionDataProtected:boolean;
 permanentStockEnabled?:boolean;
 clientProjectMatchesServer:boolean;
 previewHost:string|null;
 issuanceEnabled:boolean;
 activationEnabled:boolean;
 minimalIdentityGateConfigured:boolean;
 emailLinkProvider:string;
 storageRulesPublished:string;
 physicalNfcVerified:boolean;
 canIssue:boolean;
};
type Writer={write(message:{records:{recordType:'url';data:string}[]},options:{overwrite:false;signal:AbortSignal}):Promise<void>};
const endpoint='/api/admin/operations/health?transport=kyrub-tag-promotional-batches';
const btn='min-h-11 rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-100 disabled:opacity-50';

function validateBatch(value:unknown):Batch{
 if(!value||typeof value!=='object')throw Error('BATCH_UNAVAILABLE');
 const record=value as Batch;
 if(!/^[a-f0-9]{32}$/.test(record.id)||record.model!=='adesivo'||!Number.isInteger(record.count)||
    record.count<1||record.count>10||!Array.isArray(record.units)||record.units.length!==record.count||
    new Set(record.units.map(u=>u.id)).size!==record.count)throw Error('BATCH_UNAVAILABLE');
 for(const unit of record.units){
  if(!isTagId(unit?.id)||unit.url!==tagUrl(unit.id)||!['not_verified','readback_confirmed','readback_stale'].includes(unit.physicalStatus))throw Error('BATCH_UNAVAILABLE');
 }
 return record;
}
function nonce(){
 const bytes=new Uint8Array(16);
 window.crypto.getRandomValues(bytes);
 return [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
}

export default function AdminKyrubTagPromotionalBatches({user}:{user:User}){
 const productionPanel=window.location.hostname==='admin.kyrub.com';
 const [batches,setBatches]=useState<Batch[]>([]);
 const [readiness,setReadiness]=useState<Readiness|null>(null);
 const [selected,setSelected]=useState('');
 const [count,setCount]=useState(1);
 const [confirm,setConfirm]=useState(false);
 const [busy,setBusy]=useState(false);
 const [ready,setReady]=useState(false);
 const [notice,setNotice]=useState('');
 const requestId=useRef<string|null>(null);
 const writer=useRef<AbortController|null>(null);
 const [writing,setWriting]=useState(false);
 async function request(method:'GET'|'POST',body?:Record<string,unknown>,signal?:AbortSignal){
  if(auth.currentUser?.uid!==user.uid)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const res=await fetch(endpoint,{method,cache:'no-store',signal,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:body?JSON.stringify(body):undefined});
  if(!res.ok){const body=await res.json().catch(()=>({}));throw Error(body.error==='second_factor_required'?'A emissão definitiva exige autenticação administrativa em dois fatores.':body.error==='reauthentication_required'?'Entre novamente com o segundo fator para emitir o lote.':'Inventário ou emissão indisponível.');}
  return res.json() as Promise<{batches?:unknown[];batch?:unknown;replay?:boolean;readiness?:Readiness}>;
 }
 useEffect(()=>{
  const ctrl=new AbortController();setReady(false);setBatches([]);setNotice('');
  void request('GET',undefined,ctrl.signal).then(result=>{
   if(ctrl.signal.aborted)return;
   setBatches((result.batches??[]).map(validateBatch));setReadiness(result.readiness??null);setReady(true);
  }).catch(()=>{if(!ctrl.signal.aborted)setNotice('Inventário indisponível. Verifique o acesso Super Admin.');});
  return()=>{ctrl.abort();writer.current?.abort();};
 },[user.uid,productionPanel]);
 async function issue(){
  if(!ready||!(readiness?.canIssue||readiness?.permanentStockEnabled)||busy||writing||!confirm)return;
  setBusy(true);setNotice('');
  const id=requestId.current??nonce();
  requestId.current=id;
  try{
   const result=await request('POST',{action:'issue',count,requestId:id});
   const batch=validateBatch(result.batch);
   if(auth.currentUser?.uid!==user.uid)return;
   setBatches(current=>[batch,...current.filter(v=>v.id!==batch.id)]);
   setSelected(batch.units[0]?.id??'');
   setNotice(result.replay?'O lote já havia sido emitido. Nenhuma unidade duplicada foi criada.':'Lote emitido no servidor. Grave cada endereço em um adesivo vazio; a gravação física ainda não foi comprovada.');
   setConfirm(false);requestId.current=null;
  }catch(error){
   setNotice(error instanceof Error?error.message:'Não foi possível confirmar a emissão. Repetir preservará a mesma solicitação, sem duplicar lote.');
  }finally{setBusy(false);}
 }
 const unit=batches.flatMap(batch=>batch.units).find(item=>item.id===selected);
 // A test with an isolated Firebase project must not write kyrub.com,
 // because production cannot resolve the isolated tag ID yet.
 const pilotHost=readiness?.previewHost;
 const pilotUrl=unit&&readiness?.isolation==='isolated-project'&&
  typeof pilotHost==='string'&&/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(pilotHost)
  ?'https://'+pilotHost+'/tag/'+unit.id:'';
 async function write(){
  if(!unit||unit.physicalStatus!=='not_verified'||!readiness?.canIssue||!pilotUrl||busy||writer.current){
   setNotice('Gravação indisponível. Use uma prévia Vercel vinculada a um projeto Firebase de homologação isolado.');
   return;
  }
  const Constructor=(window as Window&{NDEFReader?:new()=>Writer}).NDEFReader;
  if(!Constructor){setNotice('Gravação NFC exige Android com Chrome compatível, NFC ativo e permissão.');return;}
  const controller=new AbortController();writer.current=controller;setWriting(true);
  setNotice('Aproxime apenas um adesivo vazio e desbloqueado. Não será sobrescrito conteúdo anterior.');
  try{
   await new Constructor().write({records:[{recordType:'url',data:pilotUrl}]},{overwrite:false,signal:controller.signal});
   if(!controller.signal.aborted)setNotice('O navegador informou gravação concluída. Afaste o adesivo e leia novamente fora do painel para confirmar o endereço. A autenticidade do chip não foi verificada.');
  }catch{
   if(!controller.signal.aborted)setNotice('Gravação não confirmada. Confira o NFC, permissões e se a etiqueta está vazia.');
  }finally{
   if(writer.current===controller){writer.current=null;setWriting(false);}
  }
 }
 if(productionPanel&&ready&&!readiness?.permanentStockEnabled)return <a className="inline-flex min-h-11 items-center rounded-xl bg-[#F47825] px-4 py-2 font-bold text-[#121A17]" href="https://kyrub-git-feat-kyrub-tag-promoti-ebbdb4-kyrubapp-6434s-projects.vercel.app/?kyrub_admin_preview=1#admin-kyrub-tag-promotional">Abrir gravador de teste</a>;
 if(!ready)return <p role="status">{notice||'Abrindo o gravador…'}</p>;
 if(productionPanel&&readiness?.permanentStockEnabled){
  const official=batches.filter(b=>b.urlMode==='permanent');
  const validated=official.flatMap(batch=>batch.units.filter(unit=>unit.physicalStatus==='readback_confirmed').map(unit=>({batchId:batch.id,unit})));
  return <section className="space-y-4 text-sm">
   <AdminKyrubTagNfcWizard key={user.uid} user={user} readiness={readiness} batches={official} onBatch={batch=>setBatches(current=>[batch,...current.filter(v=>v.id!==batch.id)])}/>
   <details className="rounded-xl border border-[#34443B] p-3">
    <summary className="cursor-pointer font-semibold">Histórico de tags validadas ({validated.length})</summary>
    <p className="mt-2 text-slate-300">Unidades com URL gravada, relida e registrada no servidor. Ativação pública ainda bloqueada.</p>
    {validated.length===0?<p className="mt-2 text-slate-400">Nenhum adesivo conferido.</p>:<div className="mt-3 space-y-2">{validated.map(({batchId,unit})=><div key={unit.id} className="rounded-lg border border-[#34443B] p-3">
     <p className="font-semibold text-emerald-300">Validada · {unit.id.slice(-8)}</p>
     <p className="text-xs text-slate-400">Lote {batchId.slice(-8)}</p>
     <p className="break-all text-xs">{unit.url}</p>
    </div>)}</div>}
   </details>
   <p className="text-xs text-slate-400">{official.length} lote(s) · Limite atual: 100 lotes.</p>
  </section>;
 }
 return <section className="space-y-4 text-sm text-slate-200">
  <AdminKyrubTagNfcWizard user={user} readiness={readiness} batches={batches}
   onBatch={batch=>{
    setBatches(current=>[batch,...current.filter(v=>v.id!==batch.id)]);
    setSelected(batch.units[0]?.id??'');
   }}/>
  <details className="space-y-3 rounded-xl border border-[#34443B] p-3">
   <summary className="cursor-pointer font-semibold">Diagnóstico do piloto</summary>
   {!readiness?<p role="status" className="text-amber-200">Não foi possível confirmar o isolamento. A emissão permanece indisponível.</p>:
    <>
     <p className={readiness.isolation==='unsafe'?'text-amber-200':'text-emerald-300'}>
      {readiness.isolation==='unsafe'?'Bloqueado: projeto Firebase de produção ou isolamento não comprovado':
       readiness.isolation==='emulator'?'Ambiente de emuladores local isolado':'Projeto Firebase exclusivo de homologação confirmado'}
     </p>
     <p>Firebase do aplicativo e do servidor: {readiness.clientProjectMatchesServer?'coincidem':'não coincidem ou não foram confirmados'}.</p>
     <p>Emissão: {readiness.issuanceEnabled?'habilitada':'desligada'} · Primeira ativação: {readiness.activationEnabled?'habilitada':'desligada'} · Identidade mínima: {readiness.minimalIdentityGateConfigured?'configurada no servidor':'não confirmada'}</p>
     <p className="text-amber-200">Login por e-mail, regras Storage publicadas e leitura NFC física ainda dependem de homologação manual.</p>
    </>}
  </details>
  <details className="space-y-3 rounded-xl border border-[#34443B] p-3">
   <summary className="cursor-pointer font-semibold">Modo manual avançado · Emissão e gravação isoladas</summary>
   <div className="mt-3 space-y-3">
   <h5 className="font-semibold">Emitir lote promocional · Adesivos NFC</h5>
   <p>Sem cadastro de e-mail nem destinatário. As etiquetas comerciais protegidas continuam separadas. Cada unidade recebe um endereço próprio.</p>
   {!readiness?.canIssue&&<p className="text-sm text-amber-200">A emissão só será liberada após configurar um projeto Firebase de homologação separado e ativar o piloto no servidor. Não há botão de desbloqueio nesta tela.</p>}
   <label className="block">Quantidade por lote (1–10)
    <input type="number" min={1} max={10} value={count} disabled={busy||writing} onChange={e=>{setCount(Number(e.target.value));setConfirm(false);requestId.current=null;}} className="mt-1 min-h-11 w-28 rounded-xl border border-[#34443B] bg-slate-900 p-3"/>
   </label>
   <label className="flex items-start gap-2">
    <input type="checkbox" checked={confirm} disabled={busy||writing||!ready} onChange={e=>setConfirm(e.target.checked)}/>
    Confirmo a emissão de identificadores promocionais sem destinatário, ainda não gravados fisicamente.
   </label>
   <button type="button" className={btn} disabled={!ready||!readiness?.canIssue||!confirm||busy||writing||!Number.isInteger(count)||count<1||count>10} onClick={()=>void issue()}>{busy?'Emitindo…':'Emitir lote promocional'}</button>
   </div>
  </details>
  <div className="space-y-3">
   <h5 className="font-semibold">Inventário de lotes emitidos</h5>
   {!ready?<p>Consultando lotes…</p>:batches.length===0?<p>Nenhum lote promocional encontrado.</p>:
    batches.map(batch=><details key={batch.id} className="rounded-xl border border-[#34443B] p-3">
     <summary className="cursor-pointer font-semibold">Lote {batch.id.slice(-8)} · {batch.count} adesivo(s)</summary>
     <div className="mt-3 space-y-2">
      {batch.units.map((entry,i)=><button type="button" key={entry.id} disabled={busy||writing} aria-pressed={selected===entry.id} className={btn+' block w-full text-left '+(selected===entry.id?'border-orange-400':'')} onClick={()=>setSelected(entry.id)}>
       Unidade {i+1} · {entry.id.slice(-8)} · {entry.physicalStatus==='readback_confirmed'?'leitura NFC conferida':entry.physicalStatus==='readback_stale'?'leitura de outro ambiente · não utilizar':'gravação não verificada'}
      </button>)}
     </div>
    </details>)}
  </div>
  {unit&&<div className="space-y-2 rounded-xl border border-orange-500/40 p-3">
   <h5 className="font-bold">Unidade {unit.id.slice(-8)}</h5>
   <p className="break-all text-xs text-slate-400">Endereço oficial reservado (ainda não utilizar): {unit.url}</p>
   {pilotUrl?<a href={pilotUrl} className="block break-all text-orange-300 underline" target="_blank" rel="noopener noreferrer">Endereço de homologação: {pilotUrl}</a>:
    <p className="text-sm text-amber-200">A URL de teste só aparece em uma prévia Vercel isolada, nunca no painel produtivo.</p>}
   {pilotUrl&&<button type="button" className={btn} onClick={()=>void navigator.clipboard.writeText(pilotUrl).then(()=>setNotice('Endereço de homologação copiado.')).catch(()=>setNotice('Selecione o endereço e copie manualmente.'))}>Copiar URL de homologação</button>}
   {unit.physicalStatus==='readback_stale'&&<p role="status" className="text-amber-200">Esta unidade tem uma conferência registrada para outro endereço de homologação. Preserve o registro e utilize uma nova unidade de teste. Não distribua nem regrave esta unidade neste painel.</p>}
   {!writing?<button type="button" className={btn} disabled={unit.physicalStatus!=='not_verified'||busy||!pilotUrl||!readiness?.canIssue} onClick={()=>void write()}>Gravar adesivo de teste</button>:
    <button type="button" className={btn} onClick={()=>writer.current?.abort()}>Cancelar gravação NFC</button>}
   <p className="text-xs text-amber-200">Esta é uma URL TEMPORÁRIA de homologação. Não distribua o adesivo, não o bloqueie permanentemente para escrita e não o considere uma Kyrub Tag oficial pronta. Após o lançamento será necessário gravar a URL definitiva.</p>
   <p className="text-xs text-slate-400">A gravação NDEF usa apenas o endereço temporário de teste. Confirme a leitura física fora do painel, em outro celular quando possível.</p>
  </div>}
  {notice&&<p role="status" className="rounded-xl border border-[#34443B] p-3">{notice}</p>}
 </section>;
}
