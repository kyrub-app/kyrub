import {useRef,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
type TrackingResult={reviewedNotice?:string;evidenceStatus?:'awaiting-evidence'|'account-control-confirmed'|'cid-control-confirmed';protocol:string;receivedAt:number;triageStatus:'pending-review'|'verification-required';identityStatus:'pending-verification';actionStatus:'not-executed';simulated:true};
export type PrivacyTrackingAdapter={confirmCid?:(protocol:string,code:string)=>Promise<{evidenceStatus:'cid-control-confirmed';identityStatus:'pending-verification';actionStatus:'not-executed';simulated:true}>;confirmAccount?:(protocol:string,code:string)=>Promise<{evidenceStatus:'account-control-confirmed';identityStatus:'pending-verification';actionStatus:'not-executed';simulated:true}>;track:(protocol:string,code:string)=>Promise<TrackingResult>;revoke:(protocol:string,code:string)=>Promise<{revoked:true;simulated:true}>};
const field='min-h-11 rounded-xl border border-[#34443B] p-3 text-sm disabled:opacity-50';
export function KyrubPrivacyTrackingPilot({adapter}:{adapter?:PrivacyTrackingAdapter}){
 const [protocol,setProtocol]=useState(''),[code,setCode]=useState(''),[result,setResult]=useState<TrackingResult|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const [confirmRevoke,setConfirmRevoke]=useState(false),lock=useRef(false);
 const ready=/^[a-f0-9-]{36}$/.test(protocol.trim())&&/^[A-Za-z0-9_-]{43}$/.test(code.trim());
 async function confirmAccount(){
  if(!adapter?.confirmAccount||!result||!ready||lock.current)return;
  lock.current=true;setBusy(true);setStatus('');
  try{const r=await adapter.confirmAccount(protocol.trim(),code.trim());if(r.simulated!==true||r.evidenceStatus!=='account-control-confirmed'||r.identityStatus!=='pending-verification'||r.actionStatus!=='not-executed')throw Error('UNCONFIRMED');setResult(v=>v?{...v,evidenceStatus:r.evidenceStatus}:null);}
  catch{setStatus('Não foi possível confirmar o controle da conta. A solicitação permanece registrada.');}finally{lock.current=false;setBusy(false);}
 }
 async function confirmCid(){
  if(!adapter?.confirmCid||!result||!ready||lock.current)return;
  lock.current=true;setBusy(true);setStatus('');
  try{const r=await adapter.confirmCid(protocol.trim(),code.trim());if(r.simulated!==true||r.evidenceStatus!=='cid-control-confirmed'||r.identityStatus!=='pending-verification'||r.actionStatus!=='not-executed')throw Error('UNCONFIRMED');setResult(v=>v?{...v,evidenceStatus:r.evidenceStatus}:null);}
  catch{setStatus('Não foi possível confirmar o controle do CID. A solicitação permanece registrada.');}finally{lock.current=false;setBusy(false);}
 }
 function clearResult(){setResult(null);setConfirmRevoke(false);setStatus('');}
 async function run(revoke=false){
  if(!adapter||!ready||lock.current||revoke&&(!result||!confirmRevoke))return;
  lock.current=true;setBusy(true);setStatus('');
  try{
   if(revoke){const r=await adapter.revoke(protocol.trim(),code.trim());if(r.revoked!==true||r.simulated!==true)throw Error('UNCONFIRMED');setCode('');setResult(null);setConfirmRevoke(false);setStatus('Código de acompanhamento revogado na homologação. A solicitação permanece registrada.');}
   else{const r=await adapter.track(protocol.trim(),code.trim());if(r.simulated!==true||r.protocol!==protocol.trim()||r.identityStatus!=='pending-verification'||r.actionStatus!=='not-executed'||!['pending-review','verification-required'].includes(r.triageStatus))throw Error('UNCONFIRMED');setResult(r);}
  }catch{setResult(null);setConfirmRevoke(false);setStatus('Não foi possível confirmar o acesso. Confira o protocolo e o código privado.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="mx-auto max-w-lg space-y-3 rounded-xl bg-[#121A17] p-4 text-[#F5F5F3]" aria-label="Acompanhar solicitação de privacidade">
  <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-[#F47825]"/><h2 className="text-base font-bold">Acompanhar solicitação</h2></div>
  <p className="text-xs text-amber-200">Homologação isolada. Não utilize dados reais.</p>
  <form className="space-y-2" onSubmit={e=>{e.preventDefault();void run();}}>
   <label className="block text-sm">Protocolo<input className={field+' block w-full bg-[#1D2924]'} value={protocol} maxLength={36} disabled={busy} onChange={e=>{clearResult();setProtocol(e.target.value);}}/></label>
   <label className="block text-sm">Código privado<input type="password" autoComplete="off" className={field+' block w-full bg-[#1D2924]'} value={code} maxLength={43} disabled={busy} onChange={e=>{clearResult();setCode(e.target.value);}}/></label>
   <button className={field+' w-full'} type="submit" disabled={!adapter||busy||!ready}>Consultar andamento</button>
  </form>
  {result&&<div className="space-y-2 rounded-xl border border-[#34443B] p-3"><strong>{result.triageStatus==='verification-required'?'Aguardando verificação de identidade':'Recebida — aguardando triagem'}</strong>{result.evidenceStatus==='cid-control-confirmed'?<p className="text-sm">Controle do CID confirmado. Análise de identidade pendente.</p>:result.evidenceStatus==='account-control-confirmed'?<p className="text-sm">Controle da conta confirmado. Análise de identidade pendente.</p>:result.triageStatus==='verification-required'&&adapter?.confirmAccount?<button type="button" className={field} disabled={busy} onClick={()=>void confirmAccount()}>Confirmar conta existente</button>:null}{result.evidenceStatus!=='cid-control-confirmed'&&result.evidenceStatus!=='account-control-confirmed'&&result.triageStatus==='verification-required'&&adapter?.confirmCid&&<button type="button" className={field} disabled={busy} onClick={()=>void confirmCid()}>Confirmar controle do CID</button>}{result.reviewedNotice&&<p className="text-sm rounded-lg border border-[#34443B] p-3">{result.reviewedNotice}</p>}<p className="text-xs">Nenhuma ação sobre seus dados foi executada. O código permite consultar apenas o andamento, não comprova identidade.</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmRevoke} disabled={busy} onChange={e=>setConfirmRevoke(e.target.checked)}/> Revogar este código privado (não cancela o pedido).</label><button className={field} type="button" disabled={busy||!confirmRevoke} onClick={()=>void run(true)}>Revogar código</button></div>}
  {status&&<p role="status" className="text-sm">{status}</p>}
  {!adapter&&<p className="text-xs">Consulta indisponível nesta prévia.</p>}
 </section>;
}
