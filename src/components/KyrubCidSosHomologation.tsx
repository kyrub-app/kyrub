import type {CidComplaintInput,CidComplaintReceipt} from '../../shared/cidOccurrenceComplaint';
import type {CidSosResolution} from '../../shared/cidSosResolution';
import {useRef,useState} from 'react';
import {KyrubCidSosAlertForm} from './KyrubCidSosAlertForm';
import {KyrubCidOccurrenceChat,type CidChatView} from './KyrubCidOccurrenceChat';
import type {CidSosRequest,CidSosSharedLocation} from '../../shared/cidSosRequest';

// This isolated surface is intentionally NOT mounted in any application route.
// An adapter must authorize every operation on the server. No Admin SDK or credentials here.
export type HomologationChatSession={
 read:()=>Promise<CidChatView>;
 send:(input:{id:string;body:string})=>Promise<void>;
 close?:()=>Promise<void>;
 resolve?:(reason:CidSosResolution)=>Promise<void>;
 revoke:()=>Promise<void>;
 exportOccurrence?:(format:'text'|'structured')=>Promise<void>;
 preserveEvidence?:(reason:string)=>Promise<{id:string;status:'pending-review'}>;
 denounceOccurrence?:(input:CidComplaintInput)=>Promise<CidComplaintReceipt>;
};
export type HomologationEntry=
 | {role:'emitter';smsAvailable:boolean;submit:(request:CidSosRequest)=>Promise<HomologationChatSession>;requestLocation?:()=>Promise<Omit<CidSosSharedLocation,'consent'>>}
 | {role:'owner';open:()=>Promise<HomologationChatSession>}
 | {role:'contact';requestConfirmation:()=>Promise<void>;confirm:(confirmation:string)=>Promise<HomologationChatSession>};
type Props={entry:HomologationEntry;privacyUrl:string};
const button='min-h-11 w-full rounded-xl border border-[#34443B] p-3 text-sm font-semibold disabled:opacity-50';
export function KyrubCidSosHomologation({entry,privacyUrl}:Props){
 // Parent must remount when changing invitation, Tag, or occurrence.
 return <Panel key={entry.role} entry={entry} privacyUrl={privacyUrl}/>;
}
function Panel({entry,privacyUrl}:Props){
 const [view,setView]=useState<CidChatView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [requested,setRequested]=useState(false),[confirmation,setConfirmation]=useState('');
 const handle=useRef<HomologationChatSession|null>(null),epoch=useRef(0),locked=useRef(false);
 async function attach(session:HomologationChatSession){
  const next=await session.read();
  if(next.role!==entry.role){await session.revoke();throw Error('CID_SESSION_ROLE');}
  handle.current=session;setView(next);setError('');
 }
 async function perform(work:()=>Promise<void>){
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');
  try{await work();}catch{setError('Não foi possível concluir a operação de homologação.');}
  finally{locked.current=false;setBusy(false);}
 }
 async function reload(session:HomologationChatSession){
  const version=epoch.current;
  try{
   const fresh=await session.read();
   if(version!==epoch.current||handle.current!==session)return;
   if(fresh.role!==entry.role)throw Error('CID_SESSION_ROLE');
   setView(fresh);
  }catch(error){
   if(version===epoch.current&&handle.current===session){handle.current=null;epoch.current++;setView(null);setError('A sessão não está disponível. Autentique-se novamente.');}
   throw error;
  }
 }
 async function leave(){
  const previous=handle.current;handle.current=null;epoch.current++;setView(null);setConfirmation('');setRequested(false);
  if(previous)try{await previous.revoke();}catch{setError('A sessão local foi descartada; a revogação no servidor não foi confirmada.');}
 }
 const session=handle.current;
 return <section aria-label="Homologação integrada SOS" className="mx-auto max-w-md space-y-3 rounded-xl bg-[#121A17] p-3 text-[#F5F5F3]">
  <p className="text-xs text-amber-200">Homologação isolada — dados fictícios; nenhum alerta real será enviado.</p>
  {view&&session?<><button type="button" className={button} disabled={busy} onClick={()=>void perform(()=>reload(session))}>Atualizar conversa</button>
   <KyrubCidOccurrenceChat view={view} simulation resolveOccurrence={view.role==='owner'&&session.resolve?async reason=>{await session.resolve!(reason);await reload(session);}:undefined} onBack={()=>void leave()} denounceOccurrence={session.denounceOccurrence} preserveEvidence={view.role==='owner'?session.preserveEvidence:undefined} actions={view.role==='owner'?{...(session.close?{close:async()=>{await session.close!();await reload(session);}}:{}),...(session.exportOccurrence?{download:()=>session.exportOccurrence!('text'),report:()=>session.exportOccurrence!('structured')}: {})}:{}} sendMessage={async input=>{await session.send(input);await reload(session);}}/>
  </>:entry.role==='emitter'?<KyrubCidSosAlertForm simulation smsAvailable={entry.smsAvailable} privacyUrl={privacyUrl} requestLocation={entry.requestLocation} submitAlert={async request=>{await attach(await entry.submit(request));return {accepted:true,simulated:true};}}/>:entry.role==='owner'?
   <button type="button" className={button} disabled={busy} onClick={()=>void perform(async()=>attach(await entry.open()))}>Acessar ocorrência por passkey</button>:
   <div className="space-y-2">
    <button type="button" className={button} disabled={busy} onClick={()=>void perform(async()=>{await entry.requestConfirmation();setRequested(true);})}>Solicitar confirmação do contato</button>
    {requested&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();void perform(async()=>{const value=confirmation;setConfirmation('');await attach(await entry.confirm(value));});}}>
     <label className="block text-sm">Confirmação recebida no canal autorizado<input aria-label="Confirmação do contato" type="password" autoComplete="off" maxLength={128} className={button+' bg-[#1D2924]'} value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy}/></label>
     <button type="submit" className={button} disabled={busy||!confirmation.trim()}>Confirmar acesso</button>
    </form>}
   </div>}
  {error&&<p role="status" className="text-xs">{error}</p>}
 </section>;
}
