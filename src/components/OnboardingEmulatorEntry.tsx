import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, reload, signOut, isSignInWithEmailLink, type User, type MultiFactorResolver } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { enterWithPassword, registerWithPassword, requestOwnEmailConfirmation, requestPasswordRecovery, requestKyrubEmailLink, completeKyrubEmailLink } from '../utils/kyrubEmailAccess';
import type { AgeStatus } from '../../shared/ageEligibility';
import {IngressLegalPreview} from './IngressLegalPreview';
import {PrivatePersonalPreview} from './PrivatePersonalPreview';
import {KyrubTotpChallenge} from './KyrubTotpChallenge';
import {KyrubTotpEnrollment} from './KyrubTotpEnrollment';
import {isKyrubMfaChallenge,resolveKyrubTotpChallenge} from '../utils/kyrubTotpAccess';
const totpPreview=import.meta.env.DEV&&import.meta.env.VITE_KYRUB_ONBOARDING_EMULATOR==='true'&&import.meta.env.VITE_KYRUB_TOTP_PREVIEW==='true';

const statuses = new Set<AgeStatus>(['pending','declared_adult','declared_underage','verified_adult','verified_underage','inconclusive','suspended']);
const labels: Record<AgeStatus,string> = {
  pending:'Informe sua data de nascimento.',
  declared_adult:'Maioridade declarada. A comprovação ainda está pendente.',
  declared_underage:'O ingresso não está disponível para menores de 18 anos.',
  verified_adult:'Maioridade comprovada. A liberação depende da política da funcionalidade.',
  verified_underage:'O ingresso não está disponível para menores de 18 anos.',
  inconclusive:'Não foi possível confirmar sua maioridade. Recursos pessoais dependem de liberação específica.',
  suspended:'A conta precisa de revisão.',
};

async function ageRequest(user: User, signal: AbortSignal, input?: {birthDate:string;declaredAdult:boolean}): Promise<AgeStatus> {
  const token = await user.getIdToken(true);
  if (auth.currentUser?.uid !== user.uid || signal.aborted) throw Error('SESSION_CHANGED');
  const response = await fetch('/api/onboarding/age', {
    signal, cache:'no-store', method:input?'POST':'GET',
    headers:{Authorization:'Bearer '+token, ...(input?{'Content-Type':'application/json'}:{})},
    ...(input?{body:JSON.stringify(input)}:{}),
  });
  if (!response.ok) throw Error('SCREENING_UNAVAILABLE');
  const result = await response.json() as {status:AgeStatus};
  if (!statuses.has(result.status) || auth.currentUser?.uid !== user.uid || signal.aborted) throw Error('SCREENING_INVALID');
  return result.status;
}

/** Explicit test-only shell. No product features, profile writes or rewards. */
export function OnboardingEmulatorEntry() {
  const [user,setUser] = useState<User|null>(null);
  const [ready,setReady] = useState(false);
  const [emailLinkPending,setEmailLinkPending] = useState(()=>new URL(window.location.href).searchParams.get('entry')==='email-access' && isSignInWithEmailLink(auth,window.location.href));
  const [verified,setVerified] = useState(false);
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [birthDate,setBirthDate] = useState('');
  const [declaredAdult,setDeclaredAdult] = useState(false);
  const [status,setStatus] = useState<AgeStatus|null>(null);
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [mfa,setMfa]=useState<MultiFactorResolver|null>(null);
  const [revision,setRevision] = useState(0);
  const running = useRef(false);
  const request = useRef<AbortController|null>(null);
  useEffect(() => onAuthStateChanged(auth, next => {
    request.current?.abort();
    setUser(next);setVerified(next?.emailVerified===true);setReady(true);
    if(next)setMfa(null);
    setStatus(null);setBirthDate('');setDeclaredAdult(false);setPassword('');setNotice('');
  }), []);
  useEffect(() => {
    request.current?.abort();
    if (!user || !verified) return;
    const controller = new AbortController();request.current=controller;
    void ageRequest(user,controller.signal).then(setStatus).catch(()=>{
      if(!controller.signal.aborted)setNotice('Não foi possível consultar a triagem. Tente novamente.');
    });
    return ()=>controller.abort();
  },[user,verified,revision]);

  const operate = async (action:()=>Promise<void>) => {
    if(running.current)return;running.current=true;setBusy(true);setNotice('');
    try{await action();}catch(error){
      if(totpPreview&&!auth.currentUser&&isKyrubMfaChallenge(error)){
        try{setMfa(resolveKyrubTotpChallenge(auth,error));setPassword('');}
        catch{setNotice('Este método de autenticação em dois fatores ainda não está disponível.');}
      }else setNotice('Não foi possível concluir a operação. Confira os dados e tente novamente.');
    }
    finally{running.current=false;setBusy(false);}
  };
  const field = 'block w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-white';
  const button = 'min-h-11 rounded-xl border border-slate-700 px-3 text-sm font-medium disabled:opacity-50';
  if(!ready)return <p role="status">Restaurando sessão…</p>;
  return <main className="min-h-screen bg-[#121A17] p-4 text-slate-100">
    <section className="mx-auto max-w-md space-y-4 rounded-2xl border border-slate-700 p-4">
      <h1 className="text-base font-bold">Ingresso Kyrub</h1>
      <p className="text-xs text-slate-400">Homologação isolada. Não utilize dados reais.</p>
      {!user ? mfa&&totpPreview?<KyrubTotpChallenge auth={auth} resolver={mfa} onComplete={()=>{setMfa(null);setEmailLinkPending(false);window.history.replaceState({},'','/');}} onCancel={()=>{setMfa(null);setPassword('');setEmailLinkPending(false);window.history.replaceState({},'','/');}}/>:<>
        <label className="block text-sm">E-mail<input className={field} type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>
        {emailLinkPending ? <>
          <p className="text-sm">Informe o mesmo e-mail que recebeu o link de acesso.</p>
          <button className={button} disabled={busy} onClick={()=>void operate(async()=>{await completeKyrubEmailLink(auth,email);setEmailLinkPending(false);})}>Confirmar acesso por e-mail</button>
          <button className={button} disabled={busy} onClick={()=>{window.history.replaceState({},'','/');setEmailLinkPending(false);}}>Cancelar link</button>
        </> : <>
        <label className="block text-sm">Senha<input className={field} type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
        <button className={button} disabled={busy} onClick={()=>void operate(async()=>{await enterWithPassword(auth,email,password);})}>Entrar</button>
        <button className={button} disabled={busy} onClick={()=>void operate(async()=>{const created=await registerWithPassword(auth,email,password);await requestOwnEmailConfirmation(auth,created);setNotice('Confira seu e-mail de confirmação.');})}>Criar conta</button>
        <button className={button} disabled={busy} onClick={()=>void operate(async()=>{await requestPasswordRecovery(auth,email).catch(()=>undefined);setNotice('Se o endereço estiver cadastrado, as instruções serão enviadas.');})}>Recuperar senha</button>
        <button className={button} disabled={busy} onClick={()=>void operate(async()=>{await requestKyrubEmailLink(auth,email);setNotice('Confira o link de acesso enviado ao seu e-mail.');})}>Enviar link de acesso</button>
        </>}
      </> : <>
        {!verified ? <>
          <p role="status">Confirme seu e-mail para continuar.</p>
          <button className={button} disabled={busy} onClick={()=>void operate(async()=>{await requestOwnEmailConfirmation(auth,user);setNotice('Solicitação de confirmação enviada.');})}>Reenviar confirmação</button>
          <button className={button} disabled={busy} onClick={()=>void operate(async()=>{await reload(user);if(auth.currentUser?.uid!==user.uid)throw Error('SESSION_CHANGED');setVerified(user.emailVerified);})}>Já confirmei meu e-mail</button>
        </> : <>
          {status && <p id="onboarding-age-status" role="status">{labels[status]}</p>}
          {status === null && <button className={button} disabled={busy} onClick={()=>setRevision(v=>v+1)}>Consultar situação</button>}
          {status === 'pending' && <form className="space-y-3" onSubmit={e=>{e.preventDefault();void operate(async()=>{
            request.current?.abort();const controller=new AbortController();request.current=controller;
            const next=await ageRequest(user,controller.signal,{birthDate,declaredAdult});
            if(!controller.signal.aborted){setStatus(next);setBirthDate('');setDeclaredAdult(false);}
          });}}>
            <label className="block text-sm">Data de nascimento<input type="date" required className={field} value={birthDate} onChange={e=>setBirthDate(e.target.value)} disabled={busy}/></label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={declaredAdult} onChange={e=>setDeclaredAdult(e.target.checked)} disabled={busy}/>Declaro ter 18 anos ou mais.</label>
            <button className={button} type="submit" disabled={busy||!birthDate}>Enviar triagem</button>
          </form>}
          {status==='verified_adult'&&totpPreview&&<KyrubTotpEnrollment key={user.uid} auth={auth} user={user}/>}
          {status==='verified_adult'&&import.meta.env.DEV&&import.meta.env.VITE_KYRUB_LEGAL_RECEIPT_PREVIEW==='true'&&<IngressLegalPreview key={user.uid} user={user}/>}
          {(status==='inconclusive'||status==='verified_adult')&&import.meta.env.DEV&&import.meta.env.VITE_KYRUB_PERSONAL_PREVIEW==='true'&&<PrivatePersonalPreview key={user.uid} user={user}/>}
          <p className="text-xs text-slate-400">A triagem não comprova maioridade nem libera o acesso às funcionalidades do Kyrub.</p>
        </>}
        <button className={button} disabled={busy} onClick={()=>void operate(async()=>{request.current?.abort();await signOut(auth);})}>Sair</button>
      </>}
      {notice&&<p role="alert" className="text-sm">{notice}</p>}
    </section>
  </main>;
}
