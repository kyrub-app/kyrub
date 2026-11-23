import {useEffect,useState} from 'react';
import {isSignInWithEmailLink,sendSignInLinkToEmail,signInWithEmailLink} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {isTagId} from '../../shared/kyrubTagContract';

export function TagEmailLinkIdentity({tagId}:{tagId:string}){
 const key='kyrub.tag.email-link.'+tagId;
 const [email,setEmail]=useState('');
 const [pending,setPending]=useState(()=>isSignInWithEmailLink(auth,window.location.href));
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  if(!isTagId(tagId)||!pending)return;
  const existing=sessionStorage.getItem(key);
  if(existing)void complete(existing);
  // An e-mail opened in a new browser tab requires typing the address again.
  // Never put the address in the NFC URL or the Firebase action URL.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tagId]);
 async function complete(address:string){
  if(busy||!isSignInWithEmailLink(auth,window.location.href))return;
  setBusy(true);setNotice('');
  try{
   const credential=await signInWithEmailLink(auth,address.trim(),window.location.href);
   sessionStorage.removeItem(key);
   window.history.replaceState({},'',window.location.pathname);
   // Mark only new, verified promotional sign-ins as tag-only. The backend
   // refuses protected/pilot units and never provisions a Kyrub user or store.
   const token=await credential.user.getIdToken(true);
   const prepared=await fetch('/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(tagId),{
    method:'POST',cache:'no-store',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({action:'prepare-promotional-identity'})
   }).then(res=>res.ok).catch(()=>false);
   setPending(false);
   setNotice(prepared?'E-mail confirmado. Agora você pode ativar ou gerenciar sua Kyrub Tag.':'E-mail confirmado, mas a ativação desta unidade ainda não foi autorizada. Se a tag já pertencer a você, confira o gerenciamento; para recuperar com outro e-mail, use o código de recuperação.');
  }catch{setNotice('Não foi possível confirmar. Confira se é o mesmo e-mail que recebeu o link e solicite outro acesso se necessário.');}
  finally{setBusy(false);}
 }
 async function send(){
  if(!isTagId(tagId)||busy||!email.trim())return;
  setBusy(true);setNotice('');
  try{
   await sendSignInLinkToEmail(auth,email.trim(),{
    url:window.location.origin+'/tag/'+tagId,
    handleCodeInApp:true
   });
   sessionStorage.setItem(key,email.trim());
   setNotice('Enviamos um link de verificação para o e-mail informado. Abra-o para continuar.');
  }catch{
   setNotice('Não foi possível enviar o link. O login por e-mail precisa estar habilitado e o domínio autorizado no Firebase.');
  }finally{setBusy(false);}
 }
 return <section className="space-y-3 rounded-xl border border-[#34443B] bg-[#1D2924] p-4">
  <h3 className="font-semibold">Acesso seguro por e-mail</h3>
  <p className="text-sm text-slate-300">{pending?'Informe o endereço que recebeu o link de verificação.':'Verifique um e-mail privado para ativar ou editar sua tag, sem preencher um cadastro completo.'}</p>
  <label className="block text-sm">E-mail de gerenciamento
   <input type="email" autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border border-[#34443B] bg-[#121A17] p-3" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} placeholder="seu@email.com" disabled={busy}/>
  </label>
  <button type="button" className="min-h-11 rounded-lg bg-[#F47825] px-4 font-semibold text-[#121A17] disabled:opacity-50" disabled={busy||!email.includes('@')} onClick={()=>void(pending?complete(email):send())}>{busy?'Processando…':pending?'Confirmar meu e-mail':'Enviar link de verificação'}</button>
  {notice&&<p role="status" className="text-sm text-slate-200">{notice}</p>}
 </section>;
}
