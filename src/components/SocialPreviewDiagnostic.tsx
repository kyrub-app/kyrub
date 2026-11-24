import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {isSocialPreviewDiagnostic,runSocialPreviewDiagnostic,SOCIAL_PREVIEW_PROJECT,SOCIAL_PREVIEW_BRANCH,type PreflightResult} from '../utils/socialPreviewDiagnostic';

export function socialPreviewDiagnosticEnabled(){
 return isSocialPreviewDiagnostic(window.location,import.meta.env.VITE_KYRUB_TAG_PILOT_CLIENT_FIREBASE==='true',auth.app.options.projectId);
}
export function SocialPreviewDiagnostic(){
 const [ready,setReady]=useState(false);
 const [signedIn,setSignedIn]=useState(false);
 const [busy,setBusy]=useState(false);
 const [result,setResult]=useState<PreflightResult|null>(null);
 const [failed,setFailed]=useState(false);
 const active=useRef<AbortController|null>(null);
 useEffect(()=>{
  const reset=()=>{active.current?.abort();active.current=null;setBusy(false);setResult(null);setFailed(false);};
  const unsubscribe=onAuthStateChanged(auth,user=>{reset();setReady(true);setSignedIn(!!user);});
  const suspend=()=>{if(document.hidden)reset();};
  document.addEventListener('visibilitychange',suspend);
  window.addEventListener('offline',reset);
  return()=>{active.current?.abort();active.current=null;unsubscribe();document.removeEventListener('visibilitychange',suspend);window.removeEventListener('offline',reset);};
 },[]);
 async function verify(){
  active.current?.abort();
  const controller=new AbortController();active.current=controller;
  setBusy(true);setResult(null);setFailed(false);
  const timeout=window.setTimeout(()=>controller.abort(),20000);
  try{
   const checked=await runSocialPreviewDiagnostic({allowed:()=>socialPreviewDiagnosticEnabled()&&!document.hidden&&navigator.onLine,current:()=>auth.currentUser,request:(url,init)=>fetch(url,init)},controller.signal);
   if(active.current===controller&&!controller.signal.aborted)setResult(checked);
  }catch{if(active.current===controller)setFailed(true);}
  finally{window.clearTimeout(timeout);if(active.current===controller){active.current=null;setBusy(false);}}
 }
 return <main className="min-h-screen bg-slate-950 text-slate-100 p-5">
  <section className="mx-auto max-w-lg space-y-4 rounded-xl border border-slate-700 p-5 text-sm">
   <h1 className="text-base font-bold">Diagnóstico de isolamento — homologação</h1>
   <p>Somente leitura. Nenhuma credencial é exibida. Não ativa a Tribo Reservada.</p>
   <p>Firebase do cliente: {SOCIAL_PREVIEW_PROJECT}</p>
   {!ready?<p role="status">Restaurando sessão…</p>:!signedIn?<p role="status">Sessão não autenticada. Volte ao aplicativo, entre e reabra este diagnóstico.</p>:<p>Sessão autenticada disponível.</p>}
   <button type="button" disabled={!ready||!signedIn||busy} onClick={()=>void verify()} className="rounded-lg bg-orange-500 px-4 py-3 font-bold text-slate-950 disabled:opacity-50">{busy?'Verificando…':'Verificar isolamento'}</button>
   <div role="status" aria-live="polite">
    {failed&&<p>Não foi possível concluir a verificação. Confira a sessão e a conexão.</p>}
    {result&&<><p>HTTP {result.status}</p>{result.verified?<dl className="space-y-1"><dt>Projeto</dt><dd>{SOCIAL_PREVIEW_PROJECT}</dd><dt>Branch</dt><dd className="break-all">{SOCIAL_PREVIEW_BRANCH}</dd><dt>identityVerified</dt><dd>true</dd><dt>reservedPilotEnabled</dt><dd>false</dd><dt>firestoreRulesVerified</dt><dd>false</dd><dt>clientCacheVerified</dt><dd>false</dd><dt>releaseApproved</dt><dd>false</dd></dl>:<p>Isolamento autenticado não comprovado.</p>}</>}
   </div>
   <a className="block underline" href="/">Voltar ao aplicativo</a>
  </section>
 </main>;
}
