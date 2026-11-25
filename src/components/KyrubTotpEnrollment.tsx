import {useEffect,useRef,useState} from 'react';
import {EmailAuthProvider,multiFactor,reauthenticateWithCredential,type Auth,type User,type TotpSecret} from 'firebase/auth';
import {beginKyrubTotpEnrollment,finishKyrubTotpEnrollment} from '../utils/kyrubTotpAccess';

const field='block w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm';
const button='min-h-11 rounded-xl border border-slate-700 px-3 text-sm disabled:opacity-50';

/** Isolated candidate UI. No persisted enrollment secret, no recovery bypass. */
export function KyrubTotpEnrollment({auth,user}:{auth:Auth;user:User}){
 const [password,setPassword]=useState('');
 const [code,setCode]=useState('');
 const [secret,setSecret]=useState<TotpSecret|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [enrolled,setEnrolled]=useState(()=>multiFactor(user).enrolledFactors.length>0);
 const alive=useRef(false);
 const running=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const current=()=>alive.current&&auth.currentUser===user&&user.emailVerified;
 const supportsPassword=user.providerData.some(provider=>provider.providerId==='password');
 async function start(){
  if(running.current||!current()||!user.email||!password||enrolled||!supportsPassword)return;
  running.current=true;setBusy(true);setNotice('');
  const credential=EmailAuthProvider.credential(user.email,password);
  setPassword('');
  try{
   await reauthenticateWithCredential(user,credential);
   if(!current())return;
   const next=await beginKyrubTotpEnrollment(auth,user);
   if(current())setSecret(next);
  }catch{if(current())setNotice('Não foi possível preparar o autenticador. Confira a senha e a disponibilidade do provedor.');}
  finally{running.current=false;if(alive.current)setBusy(false);}
 }
 async function confirm(){
  if(running.current||!current()||!secret||!/^\d{6}$/.test(code))return;
  running.current=true;setBusy(true);setNotice('');
  try{
   await finishKyrubTotpEnrollment(auth,user,secret,code);
   if(current()){setSecret(null);setEnrolled(true);setNotice('Autenticador cadastrado. Uma nova autenticação com o segundo fator é necessária para acessar funções protegidas.');}
  }catch{if(current())setNotice('Não foi possível confirmar o cadastro. Confira o código ou cancele e reinicie.');}
  finally{running.current=false;if(alive.current){setCode('');setBusy(false);}}
 }
 if(enrolled)return <section aria-label="Autenticador" className="space-y-2 rounded-xl border border-slate-700 p-3"><h2 className="text-base font-semibold">Autenticação em dois fatores</h2><p className="text-sm">Há um segundo fator cadastrado. Isso não comprova uma sessão autenticada com dois fatores.</p>{notice&&<p role="status" className="text-sm">{notice}</p>}</section>;
 return <section aria-label="Cadastrar autenticador" className="space-y-3 rounded-xl border border-slate-700 p-3">
  <h2 className="text-base font-semibold">Cadastrar autenticador</h2>
  <p className="text-xs text-slate-400">Homologação isolada. Use apenas uma conta descartável de teste. A recuperação de acesso ainda não está liberada.</p>
  {!supportsPassword?<p className="text-sm">Esta prévia exige uma conta de teste com senha.</p>:!secret?<form className="space-y-2" onSubmit={e=>{e.preventDefault();void start();}}>
   <label className="block text-sm">Confirme sua senha<input className={field} type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
   <button className={button} type="submit" disabled={busy||!password}>Preparar autenticador</button>
  </form>:<form className="space-y-2" onSubmit={e=>{e.preventDefault();void confirm();}}>
   <p className="text-sm">No seu aplicativo autenticador, crie uma conta Kyrub com a chave abaixo. Não compartilhe a chave.</p>
   <p className="break-all rounded-lg bg-slate-900 p-3 font-mono text-sm" aria-label="Chave temporária de inscrição">{secret.secretKey}</p>
   <label className="block text-sm">Código de confirmação<input className={field} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,'').slice(0,6))}/></label>
   <button className={button} type="submit" disabled={busy||!/^\d{6}$/.test(code)}>Confirmar cadastro</button>
   <button className={button} type="button" disabled={busy} onClick={()=>{setSecret(null);setCode('');setNotice('');}}>Cancelar cadastro</button>
  </form>}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>;
}
