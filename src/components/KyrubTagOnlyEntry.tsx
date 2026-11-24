import {useEffect,useState} from 'react';
import {isTagId,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
import type {User} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {PresentationFooter} from './PresentationFooter';
import {availableTagImages,importTagProfileImages,PROFILE_IMPORT_LABELS,type ProfileImportSlot} from '../utils/profileTagImageImport';

/**
 * An email-only Kyrub Tag identity can browse without silently becoming a full
 * account. A deliberate button click authorizes the normal app bootstrap.
 */
export function KyrubTagOnlyEntry({user,onPromoted,onRetry,unavailable=false}:{
 user:User;onPromoted:()=>void;onRetry:()=>void;unavailable?:boolean
}){
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [tags,setTags]=useState<OwnedKyrubTag[]>([]);
 const [sourceId,setSourceId]=useState('');
 const [imageSlots,setImageSlots]=useState<ProfileImportSlot[]>([]);
 const [promoted,setPromoted]=useState(false);
 const [tagsReady,setTagsReady]=useState(false);
 useEffect(()=>{
  const ctrl=new AbortController();setTagsReady(false);setTags([]);setSourceId('');
  if(unavailable)return()=>ctrl.abort();
  void user.getIdToken().then(token=>fetch('/api/health?transport=manage-kyrub-tag',{
   cache:'no-store',signal:ctrl.signal,headers:{Authorization:'Bearer '+token}
  })).then(async res=>{
   if(!res.ok)throw Error('TAG_LIST_UNAVAILABLE');
   const result=await res.json() as {tags?:OwnedKyrubTag[]};
   if(ctrl.signal.aborted||auth.currentUser?.uid!==user.uid)return;
   setTags((result.tags??[]).filter(tag=>isTagId(tag.id)));
  }).catch(()=>{}).finally(()=>{if(!ctrl.signal.aborted)setTagsReady(true);});
  return()=>ctrl.abort();
 },[user.uid,unavailable]);
 async function promote(){
  if(busy||auth.currentUser?.uid!==user.uid)return;
  setBusy(true);setNotice('');
  try{
   if(promoted){
    if(sourceId&&imageSlots.length){
     try{await importTagProfileImages(user.uid,sourceId,imageSlots);}catch{setNotice('Sua conta já está criada. As imagens poderão ser importadas pelo editor do perfil.');return;}
    }
    onPromoted();return;
   }
   const token=await user.getIdToken(true);
   const res=await fetch('/api/health?transport=manage-kyrub-tag',{
    method:'POST',cache:'no-store',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(sourceId?{action:'promote-tag-identity-with-presentation',sourceTagId:sourceId}:{action:'promote-tag-identity'})
   });
   if(!res.ok)throw Error('TAG_IDENTITY_PROMOTION_FAILED');
   const result=await res.json() as {mode:string};
   if(result.mode!=='full'||auth.currentUser?.uid!==user.uid)throw Error('TAG_IDENTITY_PROMOTION_FAILED');
   setPromoted(true);
   if(sourceId&&imageSlots.length){
    try{await importTagProfileImages(user.uid,sourceId,imageSlots);}
    catch{setNotice('Sua conta foi criada. Não foi possível confirmar a importação das imagens. Você pode tentar novamente ou continuar e importar no editor do perfil.');return;}
   }
   onPromoted();
  }catch{
   setNotice('Não foi possível concluir o cadastro completo agora. Sua Kyrub Tag permanece protegida.');
  }finally{setBusy(false);}
 }
 const eligible=tags.filter(tag=>tag.distribution==='promotional'&&tag.enabled&&!tag.blocked&&tag.presentation);
 const source=eligible.find(tag=>tag.id===sourceId);
 return <main className="flex min-h-[100dvh] items-center justify-center bg-[#121A17] p-5 text-white">
  <section className="w-full max-w-md space-y-4 rounded-3xl border border-[#34443B] bg-[#1D2924] p-6">
   <p className="text-sm font-bold uppercase tracking-wide text-[#F47825]">Kyrub Tag</p>
   <h1 className="text-2xl font-bold">{unavailable?'Confirmando seu acesso':'Sua Tag está pronta para acompanhar você'}</h1>
   <p className="text-sm leading-6 text-slate-300">{unavailable?
    'Não foi possível confirmar o tipo de acesso desta sessão. Por segurança, a criação de uma conta completa não será iniciada automaticamente.':
    'Você já pode administrar sua etiqueta sem cadastrar uma loja ou criar um perfil completo no Kyrub. Quando quiser, ative sua conta Kairubido.'}</p>
   {!unavailable&&<div className="space-y-2 rounded-xl border border-[#34443B] p-3">
    <h2 className="font-semibold">Minhas Kyrub Tags</h2>
    {!tagsReady?<p className="text-sm text-slate-300">Consultando suas unidades…</p>:
     tags.length?tags.map(tag=><a key={tag.id} href={'/tag/'+tag.id} className="block rounded-lg border border-[#34443B] p-3 text-sm">
      {tag.nickname||'Adesivo'} {tag.id.slice(-8)} · {tag.blocked?'Bloqueado':tag.enabled?'Público':'Não publicado'} · Gerenciar
     </a>):<p className="text-sm text-slate-300">Nenhuma tag vinculada encontrada. Se já ativou um adesivo, abra novamente seu endereço.</p>}
   </div>}
   {!unavailable&&eligible.length>0&&<section className="space-y-3 rounded-xl border border-[#34443B] p-3">
    <h2 className="font-semibold">Aproveite sua apresentação</h2>
    <p className="text-sm text-slate-300">Escolha se deseja usar o nome, a atividade e a biografia de uma Tag no seu novo perfil Kairubido. Sua Tag não será alterada.</p>
    <label className="block text-sm">Apresentação de origem
     <select value={sourceId} disabled={busy||promoted} onChange={e=>{setSourceId(e.target.value);setImageSlots([]);}} className="mt-1 min-h-11 w-full rounded-xl bg-[#121A17] p-2">
      <option value="">Começar sem importar</option>
      {eligible.map(tag=><option key={tag.id} value={tag.id}>{tag.nickname||tag.presentation?.name||'Adesivo'} · {tag.id.slice(-8)}</option>)}
     </select>
    </label>
    {source?.presentation&&<div className="space-y-1 text-sm"><p className="font-semibold">{source.presentation.name||'Kairubido'}</p><p>{source.presentation.occupation}</p><p className="whitespace-pre-wrap">{source.presentation.about.slice(0,280)}</p>
     {source.presentation.about.length>280&&<p className="text-amber-200">A biografia do perfil aceita 280 caracteres. A versão completa ficará preservada na Tag.</p>}
     {availableTagImages(source).length>0&&<fieldset className="space-y-2 border-t border-[#34443B] pt-3"><legend className="text-sm font-semibold">Imagens opcionais</legend>{availableTagImages(source).map(slot=><label key={slot} className="flex min-h-10 items-center gap-2"><input type="checkbox" disabled={busy||promoted} checked={imageSlots.includes(slot)} onChange={e=>{const checked=e.target.checked;setImageSlots(current=>checked?[...current,slot]:current.filter(item=>item!==slot));}}/>{PROFILE_IMPORT_LABELS[slot]}</label>)}<p className="text-xs text-slate-300">As imagens selecionadas serão copiadas para seu perfil, onde poderão ser exibidas publicamente. As cópias são independentes da Tag.</p></fieldset>}
     <p className="text-xs text-slate-300">Ao criar a conta, estes dados serão usados no perfil. SOS e código de recuperação não serão importados. Você poderá editar a apresentação e a visibilidade do perfil.</p></div>}
   </section>}
   {!unavailable&&!promoted&&<PresentationFooter context="owner" mode="tag_only" busy={busy} onJoin={()=>void promote()}/>}
   {promoted&&<div className="space-y-2"><button type="button" disabled={busy} className="min-h-11 w-full rounded-xl border border-[#F47825] p-3 text-sm font-bold" onClick={()=>void promote()}>Tentar importar novamente</button><button type="button" disabled={busy} className="min-h-11 w-full rounded-xl bg-[#F47825] p-3 font-bold text-[#121A17]" onClick={onPromoted}>Continuar para o Kyrub</button></div>}
   {/* Explicit consent action: Quero criar minha conta Kairubido. */}
   <a className="block min-h-11 rounded-xl border border-[#34443B] p-3 text-center text-sm" href="/?entry=welcome">Conhecer o Kyrub sem criar conta</a>
   {unavailable&&<button type="button" className="w-full rounded-xl border border-[#34443B] p-3 text-sm" onClick={onRetry}>Tentar verificar novamente</button>}
   {notice&&<p role="status" className="text-sm text-amber-200">{notice}</p>}
  </section>
 </main>;
}
