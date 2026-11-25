import {useRef,useState} from 'react';
import type {Auth,MultiFactorResolver} from 'firebase/auth';
import {completeKyrubTotpChallenge,listTotpFactors} from '../utils/kyrubTotpAccess';

export function KyrubTotpChallenge({auth,resolver,onComplete,onCancel}:{
 auth:Auth;resolver:MultiFactorResolver;onComplete:()=>void;onCancel:()=>void
}){
 const factors=listTotpFactors(resolver);
 const [factor,setFactor]=useState(factors[0]?.id??'');
 const [code,setCode]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const running=useRef(false);
 async function confirm(){
  if(running.current||!factor||!/^\d{6}$/.test(code)||auth.currentUser)return;
  running.current=true;setBusy(true);setNotice('');
  try{
   await completeKyrubTotpChallenge(auth,resolver,factor,code);
   onComplete();
  }catch{
   setNotice('Não foi possível confirmar o código. Confira seu aplicativo autenticador ou reinicie o acesso.');
  }finally{setCode('');running.current=false;setBusy(false);}
 }
 return <form className="space-y-3" aria-label="Confirmação em dois fatores" onSubmit={e=>{e.preventDefault();void confirm();}}>
  <h2 className="text-base font-semibold">Confirmação em dois fatores</h2>
  <p className="text-sm">Digite o código temporário do seu aplicativo autenticador.</p>
  {factors.length>1&&<label className="block text-sm">Autenticador<select className="block w-full rounded-xl border border-slate-700 bg-slate-900 p-3" value={factor} disabled={busy} onChange={e=>{setFactor(e.target.value);setCode('');}}>{factors.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
  <label className="block text-sm">Código do autenticador<input className="block w-full rounded-xl border border-slate-700 bg-slate-900 p-3" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,'').slice(0,6))}/></label>
  <button className="min-h-11 rounded-xl bg-[#F27429] px-3 text-sm font-semibold text-[#121A17] disabled:opacity-50" type="submit" disabled={busy||!factor||!/^\d{6}$/.test(code)}>Confirmar código</button>
  <button className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm" type="button" disabled={busy} onClick={()=>{setCode('');onCancel();}}>Cancelar acesso</button>
  {notice&&<p role="alert" className="text-sm">{notice}</p>}
 </form>;
}
