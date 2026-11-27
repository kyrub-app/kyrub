import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {normalizePersonalPixKey,type PersonalPixKeyType} from '../../../shared/personalPixDestination';
type Mask={revision:number;keyType:PersonalPixKeyType;maskedKey:string;ownershipVerified:false};
type View={offerId:string;sourceDigest:string;direction:'additional'|'refund';amountMinor:number;role:'recipient'|'payer';storeRefund:boolean;consentRevision:number|null;authorized:boolean;revoked:boolean;disclosed:boolean;blocked:boolean;financialState:string;destination:Mask|null;bankVerified:false};
type Action='authorize_adjustment_pix'|'revoke_adjustment_pix'|'reveal_adjustment_pix';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const types=['cpf','email','phone','random'];
const validRevision=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
export default function FreelaFixedAdjustmentPix({user,offerId,sourceDigest,amountMinor,direction}:{user:User;offerId:string;sourceDigest:string;amountMinor:number;direction:'additional'|'refund'}){
 const [v,setV]=useState<View|null>(null),[pending,setPending]=useState<Action|null>(null),[notSent,setNotSent]=useState(false),[secret,setSecret]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 useEffect(()=>{if(!secret)return;const hide=()=>setSecret(null),visibility=()=>{if(document.hidden)hide();},timer=window.setTimeout(hide,30000);window.addEventListener('blur',hide);document.addEventListener('visibilitychange',visibility);return()=>{window.clearTimeout(timer);window.removeEventListener('blur',hide);document.removeEventListener('visibilitychange',visibility);};},[secret]);
 async function run(action?:Action){
  if(active.current||auth.currentUser?.uid!==user.uid)return;
  const revision=action==='revoke_adjustment_pix'?v?.consentRevision:v?.destination?.revision;
  if(action&&(!validRevision(revision)||action==='reveal_adjustment_pix'&&!notSent))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setSecret(null);setPending(null);setNotSent(false);
  try{
   const token=await user.getIdToken();if(!live())return;
   const url='/api/freelance/finance',headers={authorization:'Bearer '+token,'content-type':'application/json'};
   if(action){
    const r=await fetch(url,{method:'POST',headers,cache:'no-store',signal:ctl.signal,body:JSON.stringify({offerId,action,sourceDigest,expectedAmountMinor:amountMinor,expectedRevision:revision,confirmed:true,...(action==='reveal_adjustment_pix'?{paymentNotSent:true}:{})})}),data=await r.json();if(!live())return;
    if(!r.ok)throw Error(data?.code==='REAUTHENTICATION_REQUIRED'?'Entre novamente para confirmar.':'Operação Pix não confirmada. Não repita transferências.');
    if(action==='reveal_adjustment_pix'){
     if(data.offerId!==offerId||data.sourceDigest!==sourceDigest||data.direction!==direction||data.amountMinor!==amountMinor||data.currency!=='BRL'||data.revision!==revision||data.bankVerified!==false||data.ownershipVerified!==false)throw Error('Consulta não confirmada.');
     const key=normalizePersonalPixKey({keyType:data.keyType,key:data.key});if(key.key!==data.key||key.keyType!==data.keyType)throw Error('Consulta não confirmada.');
     if(!document.hidden&&document.hasFocus())setSecret(key.key);
     return;
    }
    if(data?.confirmed!==true)throw Error('Operação não confirmada.');
   }
   const r=await fetch(url+'?view=fixed_adjustment_pix&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:ctl.signal}),data=await r.json();if(!live())return;
   if(!r.ok||data.offerId!==offerId||data.sourceDigest!==sourceDigest||data.direction!==direction||data.amountMinor!==amountMinor||data.bankVerified!==false||!['recipient','payer'].includes(data.role)||![data.storeRefund,data.authorized,data.revoked,data.disclosed,data.blocked].every(x=>typeof x==='boolean')||!(data.consentRevision===null||validRevision(data.consentRevision))||data.authorized&&data.revoked||!['awaiting_payment','awaiting_receipt','nonreceipt_reported','disputed','receipt_reported','bilaterally_reported_received'].includes(data.financialState)||data.blocked!==(data.storeRefund||!['awaiting_payment','nonreceipt_reported'].includes(data.financialState))||!(data.destination===null||data.destination&&validRevision(data.destination.revision)&&types.includes(data.destination.keyType)&&typeof data.destination.maskedKey==='string'&&/^••••.{4}$/.test(data.destination.maskedKey)&&data.destination.ownershipVerified===false))throw Error('Consulta Pix indisponível.');
   setV(data);
  }catch(e){if(live()){setV(null);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 return <section aria-label="Pix da regularização" className="space-y-2 rounded-xl border border-slate-700 p-3"><h6 className="font-bold">Pix da {direction==='refund'?'devolução':'regularização complementar'}</h6><p>Homologação: {money(amountMinor)}. Não realize transferência real.</p><button type="button" className={btn} disabled={busy||!!pending} onClick={()=>void run()}>Consultar autorização da regularização</button>{error&&<p role="alert">{error}</p>}
 {v&&<><p>{v.role==='recipient'?'Você é o destinatário.':'Você é o responsável pelo pagamento.'}</p>{v.storeRefund?<p>Devolução de loja: destino empresarial ainda não homologado. Não utilize a chave pessoal do representante.</p>:<>{v.financialState==='nonreceipt_reported'&&<p>Não recebimento informado, sem declaração de pagamento. Confira se não houve transferência antes de prosseguir.</p>}{v.blocked&&!v.storeRefund&&<p>Consulta Pix bloqueada por manifestação financeira. Não repita transferências; consulte as declarações da regularização.</p>}<p>{v.revoked?'Autorização retirada':v.authorized?'Autorização registrada':'Aguardando autorização do destinatário'}</p>{v.destination&&<p>Chave {v.destination.keyType}: {v.destination.maskedKey} (titularidade bancária não verificada)</p>}{v.role==='recipient'&&!v.destination&&!v.authorized&&!v.revoked&&<p>Cadastre uma chave na Carteira pessoal antes de autorizar.</p>}{!v.blocked&&v.role==='recipient'&&!v.authorized&&!v.revoked&&v.destination&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('authorize_adjustment_pix')}>Autorizar compartilhamento para esta obrigação</button>}{v.role==='recipient'&&v.authorized&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('revoke_adjustment_pix')}>Retirar autorização</button>}{!v.blocked&&v.role==='payer'&&v.authorized&&v.destination&&<button type="button" className={btn} disabled={busy||!!pending} onClick={()=>setPending('reveal_adjustment_pix')}>Consultar chave integral</button>}{(v.revoked||v.authorized&&!v.destination)&&<p>Não utilize a chave anterior. Substituição consensual ainda não habilitada.</p>}</>}</>}
 {pending&&<div className="space-y-2"><p>{pending==='authorize_adjustment_pix'?'Confirma a divulgação exclusivamente ao pagador desta obrigação?':pending==='revoke_adjustment_pix'?'Retirar autorização impede novas consultas, não recupera dados já visualizados.':'Confirme o valor e não repita uma transferência já realizada.'}</p>{pending==='reveal_adjustment_pix'&&<label className="flex gap-2"><input type="checkbox" checked={notSent} onChange={e=>setNotSent(e.target.checked)}/>Declaro que ainda não enviei esta regularização.</label>}<button type="button" className={btn} disabled={busy||pending==='reveal_adjustment_pix'&&!notSent} onClick={()=>void run(pending)}>Confirmar operação</button>{' '}<button type="button" className={btn} onClick={()=>{setPending(null);setNotSent(false);}}>Voltar</button></div>}
 {secret&&<div><p>Chave Pix desta obrigação: <span className="break-all">{secret}</span></p><button type="button" className={btn} onClick={()=>setSecret(null)}>Ocultar chave</button></div>}
 </section>;
}
