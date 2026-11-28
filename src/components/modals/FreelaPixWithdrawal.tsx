import {useEffect,useRef,useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
type Consent={revision:number;sharingSequence:number;sharingAuthorized:boolean;sharingRevoked:boolean};
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-teal-300 disabled:opacity-50';
function valid(v:unknown):v is Consent{
 if(!v||typeof v!=='object')return false;
 const c=v as Consent;
 return Object.keys(c).length===4&&Number.isSafeInteger(c.revision)&&c.revision>0&&Number.isSafeInteger(c.sharingSequence)&&c.sharingSequence>=0&&typeof c.sharingAuthorized==='boolean'&&typeof c.sharingRevoked==='boolean'&&c.sharingRevoked===(c.sharingSequence%2===1)&&!(c.sharingAuthorized&&c.sharingRevoked)&&(c.sharingSequence===0||c.sharingAuthorized!==c.sharingRevoked);
}
export default function FreelaPixWithdrawal({user,offerId}:{user:User;offerId:string}){
 const [data,setData]=useState<Consent|null>(null),[pending,setPending]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const active=useRef<AbortController|null>(null);
 useEffect(()=>()=>{active.current?.abort();active.current=null;},[]);
 async function execute(revoke=false){
  if(active.current||auth.currentUser?.uid!==user.uid||(revoke&&(!data?.sharingAuthorized||!pending)))return;
  const ctl=new AbortController();active.current=ctl;const live=()=>!ctl.signal.aborted&&auth.currentUser?.uid===user.uid;
  setBusy(true);setError('');setMessage('');
  try{
   const token=await user.getIdToken();if(!live())return;
   const headers={authorization:'Bearer '+token,'content-type':'application/json'},url='/api/freelance/finance';
   if(revoke){
    const r=await fetch(url,{method:'POST',headers,cache:'no-store',signal:ctl.signal,body:JSON.stringify({offerId,action:'revoke_pix_share',expectedRevision:data!.revision,expectedSequence:data!.sharingSequence,confirmed:true})}),ack=await r.json();if(!live())return;
    if(!r.ok||ack?.confirmed!==true)throw Error(ack?.code==='REAUTHENTICATION_REQUIRED'?'Entre novamente para revogar.':'Revogação não confirmada. Consulte novamente.');
    setMessage('Compartilhamento revogado neste contrato.');
   }
   const r=await fetch(url+'?view=pix_withdrawal&offerId='+encodeURIComponent(offerId),{headers,cache:'no-store',signal:ctl.signal}),v=await r.json();if(!live())return;
   if(!r.ok)throw Error(v?.code==='FREELANCE_PIX_DESTINATION_REQUIRED'?'Nenhuma chave vinculada a este contrato.':'Não foi possível confirmar o consentimento.');
   if(!valid(v))throw Error('Resposta de consentimento inválida.');
   setData(v);setPending(false);
  }catch(e){if(live()){setData(null);setPending(false);setError(e instanceof Error?e.message:'Consulta indisponível.');}}
  finally{if(active.current===ctl){active.current=null;if(live())setBusy(false);}}
 }
 if(auth.currentUser?.uid!==user.uid)return null;
 return <section aria-label="Privacidade Pix do contrato" className="space-y-2 rounded-xl border border-slate-700 p-3 text-sm">
  <h5 className="font-bold">Privacidade Pix do contrato</h5>
  <p>Retire a autorização de consulta mesmo após o encerramento do serviço. Nenhuma chave será exibida.</p>
  <button type="button" className={btn} disabled={busy||pending} onClick={()=>void execute()}>Consultar autorização Pix</button>
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {data&&<p>{data.sharingAuthorized?'Compartilhamento autorizado':data.sharingRevoked?'Compartilhamento revogado':'Compartilhamento não autorizado'}</p>}
  {data?.sharingAuthorized&&!pending&&<button type="button" className={btn} disabled={busy} onClick={()=>setPending(true)}>Retirar autorização Pix</button>}
  {pending&&<div><p>Confirma a retirada? Impede novas consultas, mas não recolhe informações já visualizadas nem altera pagamentos ou a chave pessoal.</p><button type="button" className={btn} disabled={busy} onClick={()=>void execute(true)}>Confirmar retirada</button>{' '}<button type="button" className={btn} disabled={busy} onClick={()=>setPending(false)}>Voltar</button></div>}
 </section>;
}
