import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {normalizePersonalPixKey,type PersonalPixKeyType} from '../../../shared/personalPixDestination';
type Role='requester'|'freelancer';
type Mask={revision:number;keyType:PersonalPixKeyType;maskedKey:string;ownershipVerified:false};
type Sharing=Mask&{sharingAuthorized:boolean;due:boolean};
type Action='bind_pix'|'authorize_pix_share'|'reveal_pix';
const labels:Record<Action,string>={bind_pix:'Vincular chave Pix ao contrato',authorize_pix_share:'Autorizar compartilhamento com o contratante',reveal_pix:'Consultar chave Pix integral'};
const types:Record<PersonalPixKeyType,string>={cpf:'CPF',email:'E-mail',phone:'Celular',random:'Chave aleatória'};
const errors:Record<string,string>={FREELANCE_PIX_DESTINATION_REQUIRED:'Chave Pix ainda não vinculada ou indisponível.',FREELANCE_PIX_DESTINATION_CHANGED:'A chave vinculada mudou. Não utilize a anterior.',FREELANCE_PIX_DISCLOSURE_UNAVAILABLE:'Compartilhamento indisponível nesta situação.',FREELANCE_PAYMENT_NOT_DUE:'Pagamento ainda não previsto nesta etapa.',REAUTHENTICATION_REQUIRED:'Entre novamente na sua conta para continuar. Atualizar a página não renova a autenticação.',FREELANCE_FORBIDDEN:'Operação não autorizada.',AUTH_REQUIRED:'Entre novamente para continuar.'};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
function mask(v:unknown):v is Mask{
 if(!v||typeof v!=='object')return false;
 const m=v as Mask;
 return Number.isSafeInteger(m.revision)&&m.revision>0&&Object.hasOwn(types,m.keyType)&&typeof m.maskedKey==='string'&&/^••••.{4}$/.test(m.maskedKey)&&m.ownershipVerified===false;
}
function sharing(v:unknown):v is Sharing{
 return mask(v)&&typeof (v as Sharing).sharingAuthorized==='boolean'&&typeof (v as Sharing).due==='boolean'&&Object.keys(v).length===6;
}
export default function FreelaPixSharing({user,offerId,role}:{user:User;offerId:string;role:Role}){
 const [current,setCurrent]=useState<Sharing|null>(null),[candidate,setCandidate]=useState<Mask|null>(null),[pending,setPending]=useState<Action|null>(null);
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
  if(action&&!revision)return;
  lock.current=true;const id=++generation.current,abort=new AbortController();request.current=abort;
  const active=()=>generation.current===id&&!abort.signal.aborted&&auth.currentUser?.uid===user.uid;
  setSecret(null);setBusy(true);setError('');setMessage('');setPending(null);setCurrent(null);setCandidate(null);
  try{
   const token=await user.getIdToken();if(!active())return;
   const headers={authorization:'Bearer '+token};
   if(action){
    const res=await fetch('/api/freelance/finance',{method:'POST',headers:{...headers,'content-type':'application/json'},cache:'no-store',signal:abort.signal,body:JSON.stringify({action,offerId,expectedRevision:revision,confirmed:true})});
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
    setMessage(action==='bind_pix'?'Chave vinculada. Autorize o compartilhamento separadamente.':'Compartilhamento autorizado para este contratante.');
   }
   const res=await fetch('/api/freelance/finance?view=pix_sharing&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:abort.signal});
   const body=await res.json().catch(()=>null);if(!active())return;
   if(res.ok){if(!sharing(body))throw Error('Consulta Pix não confirmada.');setCurrent(body);return;}
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
  <p>Dados fictícios de homologação. Titularidade não verificada. Confira o destinatário no aplicativo bancário antes de pagar.</p>
  <button type="button" className={btn} disabled={busy} onClick={()=>void execute()}>Consultar chave vinculada</button>
  {busy&&<p role="status">Consultando Pix…</p>}{error&&<p role="alert" className="text-amber-300">{error}</p>}{message&&<p role="status">{message}</p>}
  {selected&&<p>{types[selected.keyType]} · {selected.maskedKey}</p>}
  {current&&<p>{current.sharingAuthorized?'Compartilhamento autorizado':'Compartilhamento ainda não autorizado'} · {current.due?'Pagamento devido':'Pagamento previsto na conclusão'}</p>}
  {candidate&&role==='freelancer'&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('bind_pix')}>{labels.bind_pix}</button>}
  {current&&role==='freelancer'&&!current.sharingAuthorized&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('authorize_pix_share')}>{labels.authorize_pix_share}</button>}
  {current&&role==='requester'&&current.sharingAuthorized&&current.due&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('reveal_pix')}>{labels.reveal_pix}</button>}
  {pending&&<div className="rounded-xl border border-teal-700 p-3 space-y-2"><p>Confirma: {labels[pending]}?</p>{pending==='authorize_pix_share'&&<p>O contratante poderá consultar esta chave integral quando o pagamento for devido. A informação já visualizada não pode ser recolhida.</p>}<button type="button" className={btn} disabled={busy} onClick={()=>void execute(pending)}>Confirmar operação Pix</button>{' '}<button type="button" className={btn} onClick={()=>setPending(null)}>Cancelar</button></div>}
  {secret&&<div className="rounded-xl border border-slate-700 p-3 space-y-2"><p>Valor contratado: {new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(secret.amountMinor/100)}</p><p className="break-all select-text" aria-label="Chave Pix autorizada">{secret.key}</p><p>Exibição temporária: até 30 segundos. Não representa pagamento confirmado.</p><button type="button" className={btn} onClick={()=>setSecret(null)}>Ocultar chave Pix</button></div>}
 </section>;
}
