import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {readOneNdefUrl} from '../../utils/kyrubTagNfcReadback';
import {isTagId,tagUrl} from '../../../shared/kyrubTagContract';

type Unit={id:string;url:string;physicalStatus:'not_verified'|'readback_confirmed'|'readback_stale'};
export type PilotBatch={id:string;model:'adesivo';urlMode?:'pilot'|'permanent';count:number;units:Unit[]};
type Readiness={isolation:'emulator'|'isolated-project'|'unsafe';canIssue:boolean;permanentStockEnabled?:boolean;previewHost?:string|null};
type Active={batchId:string;unit:Unit};
type Phase='idle'|'preparing'|'prepared'|'writing'|'awaiting_readback'|'reading'|'reporting'|'confirmed';
type NFCReader={
 write(message:{records:{recordType:'url';data:string}[]},options:{overwrite:false;signal:AbortSignal}):Promise<void>;
 scan(options:{signal:AbortSignal}):Promise<void>;
 addEventListener(name:'reading'|'readingerror',listener:(event:unknown)=>void):void;
};
type NFCConstructor=new()=>NFCReader;
const endpoint='/api/admin/operations/health?transport=kyrub-tag-promotional-batches';
const control='min-h-11 rounded-xl border border-slate-600 px-4 py-2 font-semibold text-sm disabled:opacity-50';
const makeNonce=()=>{
 const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
 return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
};
const checkBatch=(batch:PilotBatch)=>{
 if(!/^[a-f0-9]{32}$/.test(batch?.id)||!Number.isInteger(batch.count)||
  batch.count<1||batch.count>10||batch.units?.length!==batch.count||
  new Set(batch.units.map(u=>u.id)).size!==batch.count||
  batch.units.some(u=>!isTagId(u.id)||u.url!==tagUrl(u.id)||
    !['not_verified','readback_confirmed','readback_stale'].includes(u.physicalStatus)))throw Error('TAG_BATCH_INVALID');
 return batch;
};
function makePilotUrl(id:string,readiness:Readiness|null){
 if(readiness?.permanentStockEnabled&&window.location.hostname==='admin.kyrub.com'&&window.location.protocol==='https:')return tagUrl(id)??'';
 const host=readiness?.previewHost;
 return readiness?.isolation==='isolated-project'&&
  typeof host==='string'&&/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(host)
  ?'https://'+host+'/tag/'+id:'';
}
/** Controlled single-piece workflow. Never claim Web NFC proves physical chip uniqueness. */
export default function AdminKyrubTagNfcWizard({user,readiness,batches,onBatch}:{
 user:User;readiness:Readiness|null;batches:PilotBatch[];onBatch:(batch:PilotBatch)=>void
}){
 const [active,setActive]=useState<Active|null>(null);
 const [phase,setPhase]=useState<Phase>('idle');
 const [notice,setNotice]=useState('');
 const [sessionVerified,setSessionVerified]=useState(0);
 const [sessionPrepared,setSessionPrepared]=useState(0);
 const [lotCount,setLotCount]=useState(1);
 const issueInFlight=useRef(false);
 const pendingIssueCount=useRef<number|null>(null);
 const requestNonce=useRef<string|null>(null);
 const writing=useRef<AbortController|null>(null);
 const reading=useRef<AbortController|null>(null);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{
  mounted.current=false;writing.current?.abort();reading.current?.abort();
 };},[]);
 const working=['preparing','writing','reading','reporting'].includes(phase);
 const permanent=readiness?.permanentStockEnabled===true&&window.location.hostname==='admin.kyrub.com'&&window.location.protocol==='https:';
 const canPilot=permanent||(readiness?.isolation==='isolated-project'&&readiness.canIssue&&
  window.location.hostname.endsWith('.vercel.app')&&window.location.protocol==='https:'&&
  !!readiness?.previewHost);
 async function endpointRequest(body:Record<string,unknown>):Promise<{batch:PilotBatch;replay:boolean}>{
  if(auth.currentUser?.uid!==user.uid)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const response=await fetch(endpoint,{
   method:'POST',cache:'no-store',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(body)
  });
  if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error==='second_factor_required'?'A sessão administrativa exige segundo fator.':error.error==='reauthentication_required'?'Entre novamente no painel para renovar a sessão administrativa.':error.error==='TAG_BATCH_LIMIT'?'Limite de lotes alcançado.':'Não foi possível confirmar a operação no servidor.');}
  return response.json() as Promise<{batch:PilotBatch;replay:boolean}>;
 }
 async function prepareNext(){
  if(!canPilot||working||active&&phase!=='confirmed')return;
  reading.current?.abort();
  if(permanent){
   if(issueInFlight.current||writing.current||reading.current)return;
   if(active){
    const batch=batches.find(b=>b.id===active.batchId);
    const unit=batch?.units.find(u=>u.physicalStatus==='not_verified');
    if(batch&&unit){
     const target={batchId:batch.id,unit};
     setActive(target);setSessionPrepared(n=>n+1);
     void writeTarget(target);
    }else{setActive(null);setPhase('idle');setNotice('Lote concluído. Todos os adesivos conferidos estão no histórico.');}
    return;
   }
   if(!Number.isInteger(lotCount)||lotCount<1||lotCount>10)return;
   if(!(window as Window&{NDEFReader?:NFCConstructor}).NDEFReader){setNotice('Use o Chrome no Android com NFC ativo.');return;}
   issueInFlight.current=true;setPhase('preparing');setNotice('Preparando o lote…');
   const requestId=requestNonce.current??makeNonce();
   const count=pendingIssueCount.current??lotCount;
   requestNonce.current=requestId;pendingIssueCount.current=count;
   try{
    const result=await endpointRequest({action:'issue',count,requestId});
    const batch=checkBatch(result.batch);
    if(batch.urlMode!=='permanent'||batch.count!==count)throw Error('Lote inválido.');
    if(!mounted.current)return;
    onBatch(batch);requestNonce.current=null;pendingIssueCount.current=null;
    setSessionPrepared(0);setSessionVerified(0);
    const unit=batch.units.find(u=>u.physicalStatus==='not_verified');
    if(!unit){setActive(null);setPhase('idle');setNotice('Lote já conferido.');return;}
    const target={batchId:batch.id,unit};
    setActive(target);setSessionPrepared(1);setPhase('prepared');
    // If the browser requires a fresh user gesture after the request,
    // writeTarget leaves the same reserved unit ready for manual retry.
    void writeTarget(target);
   }catch(error){
    if(mounted.current){setPhase('idle');setNotice((error instanceof Error?error.message:'Falha ao preparar lote.')+' Tente novamente com a mesma quantidade.');}
   }finally{issueInFlight.current=false;}
   return;
  }
  setPhase('preparing');setNotice('');
  const requestId=requestNonce.current??makeNonce();
  requestNonce.current=requestId;
  try{
   const result=await endpointRequest({action:'issue',count:1,requestId});
   const batch=checkBatch(result.batch);
   if(batch.count!==1)throw Error('TAG_BATCH_INVALID');
   if(!mounted.current)return;
   requestNonce.current=null;
   setActive({batchId:batch.id,unit:batch.units[0]});
   setSessionPrepared(n=>n+1);
   onBatch(batch);
   setPhase('prepared');
   setNotice('Identificador reservado. Toque em Gravar e aproxime UM adesivo NFC vazio.');
  }catch{
   if(mounted.current){setPhase(active?'confirmed':'idle');
    setNotice('Não foi possível reservar a unidade. Tente novamente: o mesmo pedido será reutilizado, sem criar outra unidade.');}
  }
 }
 function beginReadback(target:Active,manual:boolean){
  if(!canPilot||reading.current||writing.current)return;
  const Ctor=(window as Window&{NDEFReader?:NFCConstructor}).NDEFReader;
  const expected=makePilotUrl(target.unit.id,readiness);
  if(!Ctor||!expected){setPhase('awaiting_readback');setNotice('A verificação NFC exige Chrome Android compatível.');return;}
  const controller=new AbortController();
  reading.current=controller;
  setPhase('reading');
  setNotice('Retire o adesivo da traseira do celular e aproxime novamente para CONFIRMAR a leitura.');
  let processed=false;
  const reader=new Ctor();
  reader.addEventListener('reading',event=>{
   if(processed||controller.signal.aborted||!mounted.current)return;
   const received=readOneNdefUrl(event);
   if(received!==expected){
    processed=true;controller.abort();reading.current=null;
    setPhase('awaiting_readback');
    setNotice('Leitura divergente: este adesivo não contém o endereço esperado. Não foi validado. Confira se aproximou o adesivo correto.');
    return;
   }
   processed=true;controller.abort();reading.current=null;
   setPhase('reporting');
   setNotice('Endereço conferido no NFC. Registrando a confirmação no inventário...');
   void endpointRequest({
    action:'confirm-readback',batchId:target.batchId,tagId:target.unit.id,readUrl:received
   }).then(result=>{
    if(!mounted.current)return;
    const batch=checkBatch(result.batch);
    const confirmedUnit=batch.units.find(unit=>unit.id===target.unit.id);
    if(batch.id!==target.batchId||confirmedUnit?.physicalStatus!=='readback_confirmed')
     throw Error('TAG_READBACK_NOT_RECORDED');
    onBatch(batch);
    setActive({batchId:batch.id,unit:confirmedUnit});
    if(!result.replay)setSessionVerified(n=>n+1);
    setPhase('confirmed');
    setNotice(permanent&&batch.units.every(u=>u.physicalStatus==='readback_confirmed')?'Lote concluído! Todos os adesivos foram conferidos.':'Informações válidas! Afaste o adesivo e toque em Próximo adesivo.');
   }).catch(()=>{
    if(mounted.current){setPhase('awaiting_readback');
     setNotice('A leitura corresponde, mas o servidor não confirmou o registro. Repita a conferência antes de avançar.');}
   });
  });
  reader.addEventListener('readingerror',()=>{
   if(processed||controller.signal.aborted||!mounted.current)return;
   processed=true;controller.abort();reading.current=null;setPhase('awaiting_readback');
   setNotice('Falha ao ler o NFC. Tente novamente com o adesivo afastado.');
  });
  void reader.scan({signal:controller.signal}).catch(()=>{
   if(controller.signal.aborted||!mounted.current)return;
   reading.current=null;setPhase('awaiting_readback');
   setNotice(manual?'Não foi possível iniciar a leitura. Confira as permissões do NFC no Chrome.':
    'A leitura automática não iniciou. Toque em Conferir leitura para autorizar o NFC.');
  });
 }
 async function writeCurrent(){
  if(!active||working)return;
  await writeTarget(active);
 }
 async function writeTarget(target:Active){
  if(target.unit.physicalStatus!=='not_verified'||!canPilot||reading.current||writing.current)return;
  const Ctor=(window as Window&{NDEFReader?:NFCConstructor}).NDEFReader;
  if(!Ctor){setNotice('Chrome no Android com NFC ativo é necessário para gravação.');return;}
  const url=makePilotUrl(target.unit.id,readiness);
  if(!url)return;
  const ctrl=new AbortController();writing.current=ctrl;
  setPhase('writing');
  setNotice('Aproxime SOMENTE um adesivo vazio. O Kyrub não vai sobrescrever etiquetas preenchidas.');
  try{
   await new Ctor().write({records:[{recordType:'url',data:url}]},{overwrite:false,signal:ctrl.signal});
   if(ctrl.signal.aborted||!mounted.current)return;
   writing.current=null;setPhase('awaiting_readback');
   setNotice('Gravação informada pelo navegador. Afaste o adesivo e aproxime novamente para verificar.');
   beginReadback(target,false);
  }catch{
   if(!ctrl.signal.aborted&&mounted.current){setPhase('prepared');
    setNotice('Gravação não concluída. Toque em Gravar para tentar novamente com esta mesma unidade, sem emitir outra.');}
  }finally{if(writing.current===ctrl)writing.current=null;}
 }
 function cancelNfc(){
  writing.current?.abort();writing.current=null;
  reading.current?.abort();reading.current=null;
  setPhase(active?.unit.physicalStatus==='readback_confirmed'?'confirmed':active?'prepared':'idle');
  setNotice('Operação NFC interrompida. A unidade não foi confirmada nem excluída.');
 }
 function resume(batch:PilotBatch,unit:Unit){
  if(working||unit.physicalStatus==='readback_stale'||(permanent&&batch.urlMode!=='permanent'))return;
  if(pendingIssueCount.current!==null)return;
  requestNonce.current=null;reading.current?.abort();writing.current?.abort();
  setActive({batchId:batch.id,unit});
  setPhase(unit.physicalStatus==='readback_confirmed'?'confirmed':'prepared');
  setNotice(unit.physicalStatus==='readback_confirmed'
    ?'Unidade já conferida no inventário. Selecione Próximo adesivo para continuar.':
    'Unidade pendente recuperada do inventário. Regrave somente em uma etiqueta vazia ou confira um adesivo que já tenha essa URL.');
 }
 const pending=batches.flatMap(batch=>batch.units.filter(unit=>unit.physicalStatus==='not_verified').map(unit=>({batch,unit})));
 const stale=batches.reduce((n,b)=>n+b.units.filter(x=>x.physicalStatus==='readback_stale').length,0);
 const allVerified=batches.reduce((n,b)=>n+b.units.filter(x=>x.physicalStatus==='readback_confirmed').length,0);
 const activeBatch=batches.find(b=>b.id===active?.batchId);
 const remaining=activeBatch?.units.some(u=>u.physicalStatus==='not_verified')??false;
 return <section className="space-y-4 rounded-xl border border-[#34443B] bg-[#18231E] p-4">
  <div>
   <h5 className="text-base font-bold">Gravar adesivos</h5>
   <p className="mt-1 text-slate-300">{permanent?'Separe os adesivos. Cada unidade terá um endereço próprio.':'Separe um adesivo vazio para o teste.'}</p>
  </div>
  {!canPilot&&<p role="status" className="rounded-lg border border-amber-400/30 p-3 text-amber-100">
   A gravação sequencial está bloqueada até a prévia usar um Firebase de homologação isolado e o Super Admin habilitar o piloto. Nenhuma tag real será cadastrada neste estado.
  </p>}
  {permanent&&!active&&<label className="block">Quantidade de adesivos (1–10)<input className="block min-h-11 w-28 rounded-xl border border-slate-600 bg-slate-900 p-3" type="number" min={1} max={10} value={lotCount} disabled={working||pendingIssueCount.current!==null} onChange={e=>setLotCount(Number(e.target.value))}/></label>}
  {active&&<div className="space-y-2 rounded-lg border border-[#34443B] p-3">
   <p className="font-semibold">{permanent&&activeBatch?'Unidade '+(activeBatch.units.findIndex(u=>u.id===active.unit.id)+1)+' de '+activeBatch.count:'Unidade atual'} · {active.unit.id.slice(-8)}</p>
   <p className="break-all text-xs text-slate-400">{permanent?'URL definitiva:':'URL de teste:'} {makePilotUrl(active.unit.id,readiness)||'indisponível'}</p>
   <p className="text-xs text-amber-200">{permanent?'Endereço definitivo. A ativação pública ainda está bloqueada.':'Não é a URL definitiva de distribuição.'} Não bloqueie a gravação do chip.</p>
  </div>}
  <div className="flex flex-wrap gap-2">
   {!active&&<button className={control} type="button" disabled={!canPilot||working||(permanent&&(!Number.isInteger(lotCount)||lotCount<1||lotCount>10))} onClick={()=>void prepareNext()}>{phase==='preparing'?'Preparando…':'Iniciar gravação'}</button>}
   {active&&phase==='confirmed'&&<button className={control+' bg-[#F47825] text-[#121A17] border-0'} type="button"
      disabled={!canPilot||working} onClick={()=>void prepareNext()}>{permanent&&!remaining?'Concluir lote':'Próximo adesivo'}</button>}
   {active&&phase==='prepared'&&<button className={control} type="button" disabled={!canPilot||working}
     onClick={()=>void writeCurrent()}>Gravar · aproximar adesivo vazio</button>}
   {active&&phase==='prepared'&&<button className={control} type="button" disabled={!canPilot||working}
     onClick={()=>beginReadback(active,true)}>Já gravei · conferir leitura</button>}
   {active&&phase==='awaiting_readback'&&<button className={control} type="button" disabled={!canPilot||working}
     onClick={()=>beginReadback(active,true)}>Conferir leitura NFC</button>}
   {working&&phase!=='preparing'&&phase!=='reporting'&&<button className={control} type="button"
    onClick={cancelNfc}>Cancelar aproximação</button>}
  </div>
  {notice&&<p role="status" aria-live="polite" className="rounded-lg bg-[#121A17] p-3">{notice}</p>}
  {pending.length>0&&<details className="rounded-lg border border-[#34443B] p-3">
   <summary className="cursor-pointer font-semibold">Retomar pendentes ({pending.length})</summary>
   <div className="mt-3 space-y-2">
    {pending.map(({batch,unit})=><button key={unit.id} type="button" className={control+' block w-full text-left'}
      disabled={!canPilot||working||pendingIssueCount.current!==null} onClick={()=>resume(batch,unit)}>Retomar unidade {unit.id.slice(-8)}</button>)}
   </div>
  </details>}
  {stale>0&&<p role="status" className="text-amber-200">{stale} unidade(s) com leitura de outro endereço de homologação. Não contam como conferidas neste ambiente. Preserve-as e utilize unidades novas para o teste.</p>}
  <details><summary className="cursor-pointer">Resumo da sessão</summary><p>{sessionPrepared} preparados · {sessionVerified} conferidos · {allVerified} conferidos no inventário visível.</p></details>
 </section>;
}
