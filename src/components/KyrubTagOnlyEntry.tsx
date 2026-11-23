import {useState} from 'react';
import type {User} from 'firebase/auth';
import {auth} from '../utils/firebase';

/**
 * An email-only Kyrub Tag identity can browse without silently becoming a full
 * account. A deliberate button click authorizes the normal app bootstrap.
 */
export function KyrubTagOnlyEntry({user,onPromoted,onRetry,unavailable=false}:{
 user:User;onPromoted:()=>void;onRetry:()=>void;unavailable?:boolean
}){
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 async function promote(){
  if(busy||auth.currentUser?.uid!==user.uid)return;
  setBusy(true);setNotice('');
  try{
   const token=await user.getIdToken(true);
   const res=await fetch('/api/health?transport=manage-kyrub-tag',{
    method:'POST',cache:'no-store',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({action:'promote-tag-identity'})
   });
   if(!res.ok)throw Error('TAG_IDENTITY_PROMOTION_FAILED');
   const result=await res.json() as {mode:string};
   if(result.mode!=='full'||auth.currentUser?.uid!==user.uid)throw Error('TAG_IDENTITY_PROMOTION_FAILED');
   onPromoted();
  }catch{
   setNotice('Não foi possível concluir o cadastro completo agora. Sua Kyrub Tag permanece protegida.');
  }finally{setBusy(false);}
 }
 return <main className="flex min-h-[100dvh] items-center justify-center bg-[#121A17] p-5 text-white">
  <section className="w-full max-w-md space-y-4 rounded-3xl border border-[#34443B] bg-[#1D2924] p-6">
   <p className="text-sm font-bold uppercase tracking-wide text-[#F47825]">Kyrub Tag</p>
   <h1 className="text-2xl font-bold">{unavailable?'Confirmando seu acesso':'Sua Tag está pronta para acompanhar você'}</h1>
   <p className="text-sm leading-6 text-slate-300">{unavailable?
    'Não foi possível confirmar o tipo de acesso desta sessão. Por segurança, a criação de uma conta completa não será iniciada automaticamente.':
    'Você já pode administrar sua etiqueta sem cadastrar uma loja ou criar um perfil completo no Kyrub. Quando quiser, ative sua conta Kairubido.'}</p>
   {!unavailable&&<button type="button" className="min-h-12 w-full rounded-xl bg-[#F47825] px-4 font-bold text-[#121A17] disabled:opacity-50" disabled={busy} onClick={()=>void promote()}>{busy?'Preparando acesso…':'Quero criar minha conta Kairubido'}</button>}
   <a className="block min-h-11 rounded-xl border border-[#34443B] p-3 text-center text-sm" href="/?entry=welcome">Conhecer o Kyrub sem criar conta</a>
   {unavailable&&<button type="button" className="w-full rounded-xl border border-[#34443B] p-3 text-sm" onClick={onRetry}>Tentar verificar novamente</button>}
   {notice&&<p role="status" className="text-sm text-amber-200">{notice}</p>}
  </section>
 </main>;
}
