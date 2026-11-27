import {useRef,useState} from 'react';
import {ShieldCheck} from 'lucide-react';
import {PRIVACY_CONTEXTS,PRIVACY_RIGHTS,type PrivacyContext,type PrivacyRight,type PrivacyRightsAdapter,type PrivacyRequestReceipt} from '../../shared/privacyRights';
// Unmounted prototype. The adapter must verify the channel and persist the
// request before returning a receipt. Never return a synthetic success.
const field='min-h-11 rounded-xl border border-[#34443B] p-3 text-sm disabled:opacity-50';
export function KyrubPrivacyRightsPilot({adapter,initialContext='ecosystem'}:{adapter?:PrivacyRightsAdapter;initialContext?:PrivacyContext}){
 const [context,setContext]=useState<PrivacyContext>(initialContext),[right,setRight]=useState<PrivacyRight|''>(''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<PrivacyRequestReceipt|null>(null);
 const lock=useRef(false);
 async function submit(){
  if(lock.current||!adapter||!right||!confirmed||receipt)return;
  lock.current=true;setBusy(true);setError('');
  try{
   const r=await adapter.submit({right,context,confirmed:true});
   if(r.status!=='received'||r.simulated!==true||!(/^[a-f0-9-]{36}$/).test(r.protocol))throw Error('PRIVACY_RECEIPT_UNCONFIRMED');
   setReceipt(r);
  }catch{setError('Não foi possível confirmar o recebimento. Nenhuma ação sobre seus dados foi executada.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section aria-label="Privacidade e meus dados" className="mx-auto max-w-lg space-y-3 rounded-xl bg-[#121A17] p-4 text-[#F5F5F3]">
  <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-[#F47825]"/><h2 className="text-base font-bold">Privacidade e meus dados</h2></div>
  <p className="text-xs text-amber-200">Homologação isolada. Não envie dados reais. O canal oficial ainda não foi ativado.</p>
  <p className="text-sm">Você poderá solicitar informações ou exercer seus direitos de privacidade sem precisar criar conta no Kyrub. A verificação adequada de identidade ocorrerá antes de disponibilizar dados ou executar alterações.</p>
  {receipt?<div role="status" className="space-y-2"><strong>Recebimento simulado confirmado</strong><p className="break-all text-sm">Protocolo: {receipt.protocol}</p><p className="text-xs">Identidade pendente de verificação. Nenhuma alteração ou exclusão foi executada.</p></div>:<form className="space-y-3" onSubmit={e=>{e.preventDefault();void submit();}}>
   <label className="block text-sm">Onde seus dados são tratados?<select aria-label="Contexto da solicitação" className={field+' block w-full bg-[#1D2924]'} disabled={busy} value={context} onChange={e=>setContext(e.target.value as PrivacyContext)}>{Object.entries(PRIVACY_CONTEXTS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="block text-sm">O que deseja solicitar?<select aria-label="Direito de privacidade" className={field+' block w-full bg-[#1D2924]'} disabled={busy} value={right} onChange={e=>setRight(e.target.value as PrivacyRight|'')}><option value="">Selecione</option>{Object.entries(PRIVACY_RIGHTS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <p className="text-xs">Não inclua CPF, documentos, senhas ou informações de saúde neste primeiro contato. O recebimento não significa atendimento concluído.</p>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo que desejo registrar esta solicitação.</label>
   <button type="submit" className={field+' w-full'} disabled={!adapter||busy||!right||!confirmed}>Registrar solicitação</button>
   {!adapter&&<p className="text-xs">Canal de recebimento indisponível nesta prévia.</p>}
  </form>}
  {error&&<p role="status" className="text-sm">{error}</p>}
 </section>;
}
