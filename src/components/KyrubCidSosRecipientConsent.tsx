import {useRef,useState} from 'react';

type RevocationHandle={id:string;secret:string};
export type CidRecipientConsentEntry=
 | {mode:'confirm';confirm:()=>Promise<{confirmed:true;revocation:RevocationHandle}>;revoke:(handle:RevocationHandle)=>Promise<{revoked:true}>}
 | {mode:'revoke';revoke:()=>Promise<{revoked:true}>};
type Props={entry:CidRecipientConsentEntry;privacyUrl:string;simulation?:boolean};
// This component is not mounted on public routes. The future HTTP adapter
// must exchange the invitation privately and never place secrets in logs.
// Confirmation and withdrawal depend on the server, not on UI state.
const field='min-h-11 w-full rounded-xl border border-[#34443B] p-3 text-sm disabled:opacity-50';
export function KyrubCidSosRecipientConsent({entry,privacyUrl,simulation=false}:Props){
 return <Panel key={entry.mode} entry={entry} privacyUrl={privacyUrl} simulation={simulation}/>;
}
function Panel({entry,privacyUrl,simulation}:Props){
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState<'initial'|'confirmed'|'revoked'|'declined'>('initial'),[error,setError]=useState('');
 const [withdraw,setWithdraw]=useState(false),[saved,setSaved]=useState(false);
 const revocation=useRef<RevocationHandle|null>(null),locked=useRef(false);
 async function run(work:()=>Promise<void>){
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');
  try{await work();}catch{setError('Não foi possível concluir. A autorização não foi alterada por esta tela. Confira a validade da solicitação e tente novamente.');}
  finally{locked.current=false;setBusy(false);}
 }
 async function accept(){
  if(entry.mode!=='confirm'||!consent||status!=='initial')return;
  await run(async()=>{
   const result=await entry.confirm();
   if(result.confirmed!==true||!result.revocation?.id||!result.revocation?.secret)throw Error('CID_CONSENT_UNCONFIRMED');
   revocation.current=result.revocation;setConsent(false);setStatus('confirmed');
  });
 }
 async function revoke(){
  if(!withdraw||status==='revoked')return;
  await run(async()=>{
   const handle=revocation.current;
   const result=entry.mode==='revoke'?await entry.revoke():handle?await entry.revoke(handle):null;
   if(result?.revoked!==true)throw Error('CID_REVOCATION_UNCONFIRMED');
   revocation.current=null;setStatus('revoked');setWithdraw(false);setSaved(false);
  });
 }
 async function copyRecovery(){
  const handle=revocation.current;if(!handle)return;
  await run(async()=>{await navigator.clipboard.writeText(handle.id+'.'+handle.secret);setSaved(true);});
 }
 return <section aria-label="Autorização de alertas SOS" className="mx-auto max-w-md space-y-3 rounded-xl bg-[#121A17] p-4 text-[#F5F5F3]">
  <h1 className="text-base font-bold text-[#F47825]">Alertas SOS · Kyrub CID</h1>
  {simulation&&<p className="text-xs text-amber-200">Homologação isolada — nenhuma comunicação real.</p>}
  {entry.mode==='confirm'&&status==='initial'&&<>
   <p className="text-sm">Seu canal foi indicado para receber alertas de um CID. O recebimento é voluntário e não comprova a existência de uma emergência.</p>
   <p className="text-sm">A autorização vale somente para este canal e este CID. Você poderá retirá-la sem criar uma conta Kyrub.</p>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/> Autorizo o recebimento de alertas SOS e avisos de resolução neste canal.</label>
   <button type="button" className={field+' bg-[#F47825] text-[#121A17] font-semibold'} disabled={!consent||busy} onClick={()=>void accept()}>Autorizar recebimento</button>
   <button type="button" className={field} disabled={busy} onClick={()=>{setConsent(false);setStatus('declined');}}>Não autorizar</button>
  </>}
  {status==='declined'&&<><p role="status" className="text-sm">Nenhuma autorização foi concedida nesta tela. Você pode fechar a página.</p><button className={field} type="button" onClick={()=>setStatus('initial')}>Voltar</button></>}
  {status==='confirmed'&&<>
   <p role="status" className="text-sm">Recebimento autorizado.</p>
   <p className="text-xs">Guarde o código privado de retirada para revogar este consentimento posteriormente. Não compartilhe o código.</p>
   <button type="button" className={field} disabled={busy} onClick={()=>void copyRecovery()}>Copiar código privado de retirada</button>
   {saved&&<p role="status" className="text-xs">Código copiado. Guarde-o em local seguro.</p>}
  </>}
  {(entry.mode==='revoke'&&status==='initial'||status==='confirmed')&&<>
   {!withdraw?<button type="button" className={field} disabled={busy} onClick={()=>setWithdraw(true)}>Retirar autorização</button>:<div className="space-y-2 rounded-lg border border-amber-500/50 p-3">
    <p className="text-sm">Retirar a autorização deste canal? Novos alertas e avisos de resolução deixarão de ser encaminhados por ele.</p>
    <button type="button" className={field} disabled={busy} onClick={()=>void revoke()}>Confirmar retirada</button>
    <button type="button" className={field} disabled={busy} onClick={()=>setWithdraw(false)}>Cancelar</button>
   </div>}
  </>}
  {status==='revoked'&&<p role="status" className="text-sm">Autorização retirada. Uma nova autorização dependerá de novo consentimento.</p>}
  {error&&<p role="alert" className="text-xs">{error}</p>}
  <a className="text-xs underline" href={privacyUrl}>Privacidade e tratamento de dados</a>
 </section>;
}
