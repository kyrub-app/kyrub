import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Destination={revision:number;status:'not_configured'|'declared'|'revoked';keyType?:'email'|'random';maskedKey?:string;ownershipVerified:false};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
export default function StoreRefundDestination({user,offerId,onChanged}:{user:User;offerId:string;onChanged:()=>void}){
 const [v,setV]=useState<Destination|null>(null),[keyType,setType]=useState<'email'|'random'>('email'),[key,setKey]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function run(action?:'declare'|'revoke'){
  if(active.current||auth.currentUser?.uid!==user.uid||action&&(!v||!confirmed||action==='declare'&&!key.trim()))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const url='/api/freelance/finance',headers={authorization:'Bearer '+token,'content-type':'application/json'};
   if(action){
    const r=await fetch(url,{method:'POST',headers,cache:'no-store',signal:ctl.signal,body:JSON.stringify({offerId,action:action==='declare'?'declare_store_refund_pix':'revoke_store_refund_pix',expectedRevision:v!.revision,confirmed:true,...(action==='declare'?{destination:{keyType,key:key.trim()},businessAccountDeclared:true}:{})})}),a=await r.json();if(!live())return;
    setKey('');setConfirmed(false);
    if(!r.ok||a?.confirmed!==true)throw Error(['second_factor_required','reauthentication_required','REAUTHENTICATION_REQUIRED'].includes(a?.code)?'Entre novamente com autenticação multifator.':'Alteração não confirmada.');
    onChanged();
   }
   const r=await fetch(url+'?view=fixed_adjustment_store_destination&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:ctl.signal}),a=await r.json();if(!live())return;
   if(!r.ok||a?.ownershipVerified!==false||!Number.isSafeInteger(a.revision)||a.revision<0||!['not_configured','declared','revoked'].includes(a.status)||a.status==='declared'&&(!['email','random'].includes(a.keyType)||typeof a.maskedKey!=='string'||!/^••••.{4}$/.test(a.maskedKey)))throw Error('Destino empresarial indisponível.');
   setV(a);
  }catch(e){if(live()){setV(null);setKey('');setConfirmed(false);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 return <section className="space-y-2 border-t border-slate-700 pt-2"><h6 className="font-bold">Destino de devoluções da loja</h6><p>Homologação. Use somente dados fictícios. O proprietário declara uma conta empresarial; titularidade bancária não verificada. Não use chave pessoal.</p><button type="button" className={btn} disabled={busy} onClick={()=>void run()}>Consultar destino da loja</button>{error&&<p role="alert">{error}</p>}{v&&<><p>{v.status==='declared'?v.maskedKey:v.status==='revoked'?'Revogado':'Não configurado'}</p><label className="block">Tipo de chave<select value={keyType} onChange={e=>{setType(e.target.value as 'email'|'random');setConfirmed(false);}}><option value="email">E-mail empresarial</option><option value="random">Aleatória empresarial</option></select></label><input aria-label="Chave empresarial fictícia" autoComplete="off" value={key} maxLength={77} onChange={e=>{setKey(e.target.value);setConfirmed(false);}}/><label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a operação; a chave declarada pertence à conta da loja.</label><button type="button" className={btn} disabled={busy||!confirmed||!key.trim()} onClick={()=>void run('declare')}>Salvar destino empresarial</button>{v.status==='declared'&&<button type="button" className={btn} disabled={busy||!confirmed} onClick={()=>void run('revoke')}>Revogar destino empresarial</button>}</>}</section>;
}
