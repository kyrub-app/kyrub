import {useEffect,useRef,useState,type FormEvent} from 'react';
import {EmailAuthProvider,GoogleAuthProvider,reauthenticateWithCredential,reauthenticateWithPopup} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {requestReservedTribePilot as request,reservedTribePilotClientEnabled} from '../utils/reservedTribePilotClient';

const button='min-h-10 rounded-xl border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-40';
const input='min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
const PROOF_WINDOW_MS=5*60*1000;
type Props={owner:string;onCancel:()=>void;onRecovered:()=>void};

/** No old code, contact list, session capability or secret persistence.
 * The server, not this UI, enforces verified auth_time and one-time recovery.
 * Only used by the emulator-only panel. */
export function ReservedTribeRecoveryPanel({owner,onCancel,onRecovered}:Props){
 const [phase,setPhase]=useState<'identity'|'code'>('identity');
 const [password,setPassword]=useState(''),[code,setCode]=useState(''),[confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef(false),generation=useRef(0),proof=useRef(0),pending=useRef<AbortController|null>(null);
 const working=useRef(false);
 const callbacks=useRef({onCancel,onRecovered});callbacks.current={onCancel,onRecovered};
 const clear=()=>{++generation.current;pending.current?.abort();pending.current=null;proof.current=0;working.current=false;setPassword('');setCode('');setConfirmation('');setBusy(false);setError('');setPhase('identity');};
 useEffect(()=>{
  active.current=true;
  const stop=auth.onAuthStateChanged(user=>{if(user?.uid!==owner){clear();callbacks.current.onCancel();}});
  const hide=()=>{if(document.hidden){clear();callbacks.current.onCancel();}};
  const pagehide=()=>{clear();callbacks.current.onCancel();};
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pagehide);
  return()=>{active.current=false;++generation.current;pending.current?.abort();pending.current=null;proof.current=0;working.current=false;stop();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pagehide);};
 },[owner]);
 useEffect(()=>{
  if(phase!=='code')return;
  const timer=window.setTimeout(()=>{clear();setError('A confirmação de identidade expirou.');},Math.max(0,proof.current-Date.now()));
  return()=>window.clearTimeout(timer);
 },[phase]);
 const user=auth.currentUser;
 const providers=user?.providerData.map(item=>item.providerId)??[];
 const usable=(g:number)=>active.current&&generation.current===g&&auth.currentUser?.uid===owner&&!document.hidden&&reservedTribePilotClientEnabled();
 async function verify(method:'google'|'password'){
  if(working.current||!user||user.uid!==owner||!user.emailVerified||!reservedTribePilotClientEnabled())return;
  const g=++generation.current,started=Date.now(),secret=password;setPassword('');setError('');working.current=true;setBusy(true);
  try{
   if(method==='google'&&providers.includes('google.com')){
    const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    const credential=await reauthenticateWithPopup(user,provider);
    if(credential.user.uid!==owner)throw Error('TRIBE_RECOVERY_DENIED');
   }else if(method==='password'&&providers.includes('password')&&user.email&&secret){
    await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,secret));
   }else throw Error('TRIBE_RECOVERY_DENIED');
   if(!usable(g)||auth.currentUser!==user)return;
   const result=await user.getIdTokenResult(true);
   if(!usable(g)||auth.currentUser!==user)return;
   const authTime=Date.parse(result.authTime),now=Date.now();
   // Force a new provider authentication; a refreshed ID token alone is insufficient.
   if(!Number.isFinite(authTime)||authTime<Math.floor(started/1000)*1000||authTime>now||now-authTime>=PROOF_WINDOW_MS||result.claims.email_verified!==true)throw Error('TRIBE_RECOVERY_DENIED');
   proof.current=authTime+PROOF_WINDOW_MS;setPhase('code');
  }catch{if(usable(g))setError('Não foi possível confirmar sua identidade. Tente novamente.');}
  finally{if(usable(g)){working.current=false;setBusy(false);}}
 }
 async function recover(event:FormEvent){
  event.preventDefault();
  if(working.current||phase!=='code'||code!==confirmation||code.length<8||code.length>64||code!==code.trim())return;
  const g=generation.current;
  if(!usable(g)||proof.current<=Date.now()){clear();setError('Confirme sua identidade novamente.');return;}
  const controller=new AbortController();pending.current=controller;working.current=true;setBusy(true);setError('');
  const fields={code,confirmation};setCode('');setConfirmation('');
  try{
   await request<{recovered:true}>('recover',fields,controller.signal);
   if(usable(g)&&!controller.signal.aborted){clear();callbacks.current.onRecovered();}
  }catch{if(usable(g)&&!controller.signal.aborted){clear();setError('Não foi possível redefinir o código. Confirme sua identidade novamente.');}}
  finally{if(pending.current===controller){pending.current=null;working.current=false;setBusy(false);}}
 }
 const cancel=()=>{clear();callbacks.current.onCancel();};
 return <section className="space-y-3 rounded-2xl border border-slate-700 p-3" aria-label="Redefinir código de acesso">
  <header className="flex items-center justify-between gap-2"><h3 className="text-base font-semibold">Redefinir código de acesso</h3><button type="button" className={button} onClick={cancel}>Cancelar</button></header>
  {error&&<p className="text-sm text-red-300" role="alert">{error}</p>}
  {phase==='identity'?<>
   <p className="text-sm text-slate-300">Confirme sua identidade para cadastrar outro código. Seus dados serão mantidos.</p>
   {providers.includes('google.com')&&<button type="button" className={button+' w-full'} disabled={busy||!user?.emailVerified} onClick={()=>void verify('google')}>Confirmar com Google</button>}
   {providers.includes('password')&&<form className="space-y-2" onSubmit={event=>{event.preventDefault();void verify('password');}}>
    <label className="block text-sm">Senha da conta<input type="password" className={input} autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/></label>
    <button className={button} disabled={busy||!password||!user?.emailVerified}>Confirmar identidade</button>
   </form>}
   {(!user?.emailVerified||!providers.some(item=>item==='google.com'||item==='password'))&&<p className="text-sm text-slate-400">É necessário um método de autenticação compatível e um e-mail verificado.</p>}
  </>:<form className="space-y-2" onSubmit={recover} autoComplete="off">
   <p className="text-sm text-slate-300">Escolha um novo código de 8 a 64 caracteres. As sessões anteriores serão encerradas.</p>
   <label className="block text-sm">Novo código<input type="password" className={input} autoComplete="new-password" value={code} onChange={event=>setCode(event.target.value)} maxLength={64} disabled={busy}/></label>
   <label className="block text-sm">Confirmar código<input type="password" className={input} autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} maxLength={64} disabled={busy}/></label>
   <button className={button+' w-full'} disabled={busy||code.length<8||code!==confirmation||code!==code.trim()}>Salvar novo código</button>
  </form>}
 </section>;
}
