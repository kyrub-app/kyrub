import {productionPersonalFinanceEnabled} from './PersonalPixSettings';
import FreelaPixWithdrawal from './FreelaPixWithdrawal';
import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {normalizePersonalPixKey,type PersonalPixKeyType} from '../../../shared/personalPixDestination';
type Role='requester'|'freelancer';
type Mask={revision:number;keyType:PersonalPixKeyType;maskedKey:string;ownershipVerified:false};
type Sharing=Mask&{sharingAuthorized:boolean;sharingSequence:number;sharingRevoked:boolean;due:boolean};
type Rebind={replacementRequired:true;oldRevision:number;newRevision:number;pending:boolean};
type Action='bind_pix'|'authorize_pix_share'|'reveal_pix'|'propose_pix_rebind'|'accept_pix_rebind'|'revoke_pix_share'|'restore_pix_share';
const labels:Record<Action,string>={bind_pix:'Vincular chave Pix ao contrato',authorize_pix_share:'Autorizar compartilhamento com o contratante',reveal_pix:'Consultar chave Pix integral',propose_pix_rebind:'Solicitar substituição da chave Pix',accept_pix_rebind:'Aceitar substituição da chave Pix',revoke_pix_share:'Revogar compartilhamento neste contrato',restore_pix_share:'Autorizar novamente neste contrato'};
const types:Record<PersonalPixKeyType,string>={cpf:'CPF',email:'E-mail',phone:'Celular',random:'Chave aleatória'};
const errors:Record<string,string>={FREELANCE_VARIABLE_PAYMENT_CONFLICT:'Apuração de jornada ainda indisponível ou em análise.',FREELANCE_PIX_DESTINATION_REQUIRED:'Chave Pix ainda não vinculada ou indisponível.',FREELANCE_PIX_DESTINATION_CHANGED:'A chave vinculada mudou. Não utilize a anterior.',FREELANCE_PIX_DISCLOSURE_UNAVAILABLE:'Compartilhamento indisponível nesta situação.',FREELANCE_PAYMENT_NOT_DUE:'Pagamento ainda não previsto nesta etapa.',REAUTHENTICATION_REQUIRED:'Entre novamente na sua conta para continuar. Atualizar a página não renova a autenticação.',FREELANCE_FORBIDDEN:'Operação não autorizada.',AUTH_REQUIRED:'Entre novamente para continuar.',FREELANCE_PAYMENT_STATEMENT_CONFLICT:'Já há manifestação financeira. Não substitua a chave nem repita o pagamento.'};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
function mask(v:unknown):v is Mask{
 if(!v||typeof v!=='object')return false;
 const m=v as Mask;
 return Number.isSafeInteger(m.revision)&&m.revision>0&&Object.hasOwn(types,m.keyType)&&typeof m.maskedKey==='string'&&/^••••.{4}$/.test(m.maskedKey)&&m.ownershipVerified===false;
}
function sharing(v:unknown):v is Sharing{
 return mask(v)&&typeof (v as Sharing).sharingAuthorized==='boolean'&&typeof (v as Sharing).due==='boolean'&&typeof (v as Sharing).sharingRevoked==='boolean'&&Number.isSafeInteger((v as Sharing).sharingSequence)&&(v as Sharing).sharingSequence>=0&&(v as Sharing).sharingRevoked===((v as Sharing).sharingSequence%2===1)&&(!(v as Sharing).sharingRevoked||!(v as Sharing).sharingAuthorized)&&Object.keys(v).length===8;
}
export default function FreelaPixSharing({user,offerId,role,hourly=false}:{user:User;offerId:string;role:Role;hourly?:boolean}){
 const [current,setCurrent]=useState<Sharing|null>(null),[candidate,setCandidate]=useState<Mask|null>(null),[pending,setPending]=useState<Action|null>(null);
 const [rebind,setRebind]=useState<Rebind|null>(null),[notSent,setNotSent]=useState(false);
 const [secret,setSecret]=useState<{key:string;amountMinor:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const generation=useRef(0),lock=useRef(false),request=useRef<AbortController|null>(null);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 useEffect(()=>{
  if(!secret)return;
  const hide=()=>setSecret(null),timer=window.setTimeout(hide,30000);
  const visibility=()=>{if(document.hidden)hide();};
  window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visibility);
  return()=>{window.clearTimeout(timer);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visibility);};
 },[secret]);
 const execute=async(action?:Action)=>{
  if(lock.current||auth.currentUser?.uid!==user.uid)return;
  const revision=action==='bind_pix'?candidate?.revision:current?.revision;
  const replacement=action==='propose_pix_rebind'||action==='accept_pix_rebind';
  if(replacement&&(!rebind||(action==='accept_pix_rebind'&&(!notSent||!rebind.pending))))return;
  const consentChange=action==='revoke_pix_share'||action==='restore_pix_share';
  if(consentChange&&(!current||(action==='revoke_pix_share'?!current.sharingAuthorized:!current.sharingRevoked)))return;
  if(action&&!replacement&&!revision)return;
  lock.current=true;const id=++generation.current,abort=new AbortController();request.current=abort;
  const active=()=>generation.current===id&&!abort.signal.aborted&&auth.currentUser?.uid===user.uid;
  setSecret(null);setBusy(true);setError('');setMessage('');setPending(null);setCurrent(null);setCandidate(null);setRebind(null);setNotSent(false);
  try{
   const token=await user.getIdToken();if(!active())return;
   const headers={authorization:'Bearer '+token};
   if(action){
    const res=await fetch('/api/freelance/finance',{method:'POST',headers:{...headers,'content-type':'application/json'},cache:'no-store',signal:abort.signal,body:JSON.stringify({action,offerId,confirmed:true,...(replacement&&rebind?{oldRevision:rebind.oldRevision,newRevision:rebind.newRevision,...(action==='accept_pix_rebind'?{paymentNotSent:true}:{})}:{expectedRevision:revision,...(consentChange?{expectedSequence:current?.sharingSequence}:{})})})});
    const body=await res.json().catch(()=>null);if(!active())return;
    if(!res.ok)throw Error(errors[body?.code]??'Operação Pix não confirmada.');
    if(action==='reveal_pix'){
     if(body?.revision!==revision||body.ownershipVerified!==false||body.bankVerified!==false||body.currency!=='BRL'||!Number.isSafeInteger(body.amountMinor)||body.amountMinor<=0||body.amountMinor>999999999)throw Error('Consulta não confirmada.');
     const normalized=normalizePersonalPixKey({keyType:body.keyType,key:body.key});
     if(normalized.key!==body.key||normalized.keyType!==body.keyType)throw Error('Consulta não confirmada.');
     // Never copy automatically, persist, log or include the key in a screenshot.
     if(!document.hidden&&document.hasFocus())setSecret({key:normalized.key,amountMinor:body.amountMinor});
     else setMessage('Consulta encerrada por perda de foco. Consulte novamente.');
     return;
    }
    if(body?.confirmed!==true)throw Error('Operação Pix não confirmada.');
    setMessage(action==='revoke_pix_share'?'Compartilhamento revogado neste contrato.':action==='restore_pix_share'?'Compartilhamento novamente autorizado.':action==='propose_pix_rebind'?'Solicitação registrada. Aguarde o aceite do contratante.':action==='accept_pix_rebind'?'Substituição aceita. Aguarde nova autorização de compartilhamento.':action==='bind_pix'?'Chave vinculada. Autorize o compartilhamento separadamente.':'Compartilhamento autorizado para este contratante.');
   }
   const res=await fetch('/api/freelance/finance?view=pix_sharing&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:abort.signal});
   const body=await res.json().catch(()=>null);if(!active())return;
   if(res.ok){if(!sharing(body))throw Error('Consulta Pix não confirmada.');setCurrent(body);return;}
   if(body?.code==='FREELANCE_PIX_DESTINATION_CHANGED'){
    const response=await fetch('/api/freelance/finance?view=pix_rebind&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:abort.signal});
    const r=await response.json().catch(()=>null);if(!active())return;
    if(response.ok&&r?.replacementRequired===true&&Number.isSafeInteger(r.oldRevision)&&r.oldRevision>0&&Number.isSafeInteger(r.newRevision)&&r.newRevision>r.oldRevision&&typeof r.pending==='boolean'&&Object.keys(r).length===4){setRebind(r);return;}
    throw Error(errors[r?.code]??errors.FREELANCE_PIX_DESTINATION_CHANGED);
   }
   if(role==='freelancer'&&body?.code==='FREELANCE_PIX_DESTINATION_REQUIRED'){
    const personal=await fetch('/api/personal-finance/pix',{headers,cache:'no-store',signal:abort.signal});
    const saved=await personal.json().catch(()=>null);if(!active())return;
    if(personal.ok&&saved?.status==='declared'&&mask(saved)){setCandidate(saved);return;}
    if(personal.ok&&['not_configured','revoked'].includes(saved?.status)){setError('Cadastre uma chave Pix em Central Pessoal → Movimentações.');return;}
   }
   throw Error(errors[body?.code]??'Consulta Pix não confirmada.');
  }catch(e){if(active())setError(e instanceof Error?e.message:'Consulta indisponível.');}
  finally{if(active()){lock.current=false;setBusy(false);}}
 };
 if(auth.currentUser?.uid!==user.uid)return null;
 const selected=current??candidate;
 return <section aria-label="Chave Pix do contrato" className="rounded-xl border border-slate-700 p-3 space-y-2 text-sm">
  <h5 className="font-bold">Chave Pix do contrato</h5>
  <p>{productionPersonalFinanceEnabled()?'Titularidade não verificada. Confira o destinatário no aplicativo bancário antes de pagar.':'Dados fictícios de homologação. Titularidade não verificada. Confira o destinatário no aplicativo bancário antes de pagar.'}</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void execute()}>Consultar chave vinculada</button>
  {busy&&<p role="status">Consultando Pix…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status">{message}</p>}
  {selected&&<p>{types[selected.keyType]} · {selected.maskedKey}</p>}
  {current&&<p>{current.sharingAuthorized?'Compartilhamento autorizado':current.sharingRevoked?'Compartilhamento revogado':'Compartilhamento ainda não autorizado'} · {current.due?'Pagamento devido':'Pagamento previsto na conclusão'}</p>}
  {candidate&&role==='freelancer'&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('bind_pix')}>{labels.bind_pix}</button>}
  {current&&role==='freelancer'&&!current.sharingAuthorized&&!current.sharingRevoked&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('authorize_pix_share')}>{labels.authorize_pix_share}</button>}
  {current&&role==='freelancer'&&current.sharingAuthorized&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('revoke_pix_share')}>{labels.revoke_pix_share}</button>}
  {current&&role==='freelancer'&&current.sharingRevoked&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('restore_pix_share')}>{labels.restore_pix_share}</button>}
  {current&&role==='requester'&&current.sharingAuthorized&&current.due&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('reveal_pix')}>{labels.reveal_pix}</button>}
  {rebind&&<div className="rounded-xl border border-amber-700 p-3 space-y-2"><p>A chave Pix vinculada foi alterada. Não utilize a chave anterior. Se já enviou o pagamento, registre a manifestação financeira; não pague novamente.</p><p>{rebind.pending?'Substituição solicitada, aguardando aceite.':'Substituição ainda não solicitada.'}</p>{role==='freelancer'&&!rebind.pending&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('propose_pix_rebind')}>{labels.propose_pix_rebind}</button>}{role==='requester'&&rebind.pending&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>{setNotSent(false);setPending('accept_pix_rebind');}}>{labels.accept_pix_rebind}</button>}</div>}
  {pending&&<div className="rounded-xl border border-teal-700 p-3 space-y-2"><p>Confirma: {labels[pending]}?</p>{(pending==='authorize_pix_share'||pending==='restore_pix_share')&&<p>O contratante poderá consultar esta chave integral quando o pagamento for devido. A informação já visualizada não pode ser recolhida.</p>}{pending==='revoke_pix_share'&&<p>Esta ação bloqueia novas consultas neste contrato. Não altera a chave pessoal, não cancela o serviço nem recupera informações já visualizadas. Se o pagamento já foi enviado, registre a manifestação financeira.</p>}{pending==='accept_pix_rebind'&&<label className="flex items-start gap-2"><input type="checkbox" checked={notSent} onChange={e=>setNotSent(e.target.checked)}/>Declaro que ainda não enviei o pagamento deste contrato.</label>}<button type="button" className={btn} disabled={busy||(pending==='accept_pix_rebind'&&!notSent)} onClick={()=>void execute(pending)}>Confirmar operação Pix</button>{' '}<button type="button" className={btn} onClick={()=>{setPending(null);setNotSent(false);}}>Cancelar</button></div>}
  {role==='freelancer'&&!busy&&!current&&!candidate&&(!!error||!!rebind)&&<FreelaPixWithdrawal key={'withdraw:'+user.uid+':'+offerId} user={user} offerId={offerId}/>}
  {secret&&<div className="rounded-xl border border-slate-700 p-3 space-y-2"><p>{hourly?'Valor final apurado':'Valor contratado'}: {new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(secret.amountMinor/100)}</p><p className="break-all select-text" aria-label="Chave Pix autorizada">{secret.key}</p><p>Exibição temporária: até 30 segundos. Não representa pagamento confirmado.</p><button type="button" className={btn} onClick={()=>setSecret(null)}>Ocultar chave Pix</button></div>}
 </section>;
}
