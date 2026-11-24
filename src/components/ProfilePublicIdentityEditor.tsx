import { PublicSocialAddressEditor } from './PublicSocialAddressEditor';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import { LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { updateProfile, type User } from 'firebase/auth';
import { doc, getDocFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import { auth, db, storage } from '../utils/firebase';
import {sanitizedWebp} from '../utils/kyrubTagMedia';
import {PresentationVisualEditor,type PresentationImageSlot} from './PresentationVisualEditor';
import {MultifunctionCardEditor} from './MultifunctionCardEditor';
import {ProfileTagPresentationSync} from './ProfileTagPresentationSync';
import {ProfileTagImageImport} from './ProfileTagImageImport';

type PublicProfileDraft={name:string;bio:string;occupation:string;photoUrl:string;coverUrl:string;backgroundUrl:string};
const imageField={avatar:'photoUrl',cover:'coverUrl',background:'backgroundUrl'} as const;
const broadcastProfileUpdate=(user:User,name:string,photoUrl:string)=>window.dispatchEvent(new CustomEvent('kyrub:profile-updated',{detail:{uid:user.uid,name,photoUrl}}));

/** The active unified profile editor. Device ownership and private account fields stay separate. */
export function ProfilePublicIdentityEditor({user}:{user:User}){
 const [draft,setDraft]=useState<PublicProfileDraft>({name:'',bio:'',occupation:'',photoUrl:'',coverUrl:'',backgroundUrl:''});
 const [loading,setLoading]=useState(true),[loadFailed,setLoadFailed]=useState(false),[saving,setSaving]=useState(false),[photoBusy,setPhotoBusy]=useState(false),[message,setMessage]=useState(''),[googlePhoto,setGooglePhoto]=useState('');
 const [saved,setSaved]=useState<PublicProfileDraft|null>(null);
 const staged=useRef<Partial<Record<PresentationImageSlot,Blob>>>({});
 const previews=useRef<Partial<Record<PresentationImageSlot,string>>>({});
 const mounted=useRef(false);
 function release(slot:PresentationImageSlot){const old=previews.current[slot];if(old)URL.revokeObjectURL(old);delete previews.current[slot];delete staged.current[slot];}
 useEffect(()=>{
  mounted.current=true;setLoading(true);setLoadFailed(false);setSaved(null);setMessage('');
  for(const slot of ['avatar','cover','background'] as const)release(slot);
  setGooglePhoto(user.providerData.find(provider=>provider.providerId==='google.com')?.photoURL||'');
  let active=true;
  void Promise.all([getDocFromServer(doc(db,'users',user.uid)),getDocFromServer(doc(db,'users',user.uid,'public_profile','main'))]).then(([account,profile])=>{
   if(!active||auth.currentUser?.uid!==user.uid)return;
   if(!account.exists())throw Error('ACCOUNT_UNAVAILABLE');
   const str=(value:unknown)=>typeof value==='string'?value:'';
   const next={name:str(profile.get('name'))||str(account.get('name'))||user.displayName||'',occupation:str(profile.get('occupation')).slice(0,90),bio:str(profile.get('bio')).slice(0,280),
    photoUrl:profile.exists()?str(profile.get('photoUrl')):str(account.get('photoUrl'))||user.photoURL||'',coverUrl:str(profile.get('coverUrl')),backgroundUrl:str(profile.get('backgroundUrl'))};
   setDraft(next);setSaved(next);
  }).catch(()=>{if(active){setLoadFailed(true);setMessage('Não foi possível carregar seu perfil. Feche e reabra quando estiver conectado.');}}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;mounted.current=false;for(const slot of ['avatar','cover','background'] as const)release(slot);};
 },[user.uid]);
 const disabled=loading||loadFailed||saving||photoBusy;
 function selectGoogle(){release('avatar');setDraft(value=>({...value,photoUrl:googlePhoto}));}
 function remove(slot:PresentationImageSlot){release(slot);setDraft(value=>({...value,[imageField[slot]]:''}));}
 async function prepare(slot:PresentationImageSlot,file:File){
  if(disabled)return;
  setPhotoBusy(true);setMessage('');
  try{
   const blob=await sanitizedWebp(file,slot);
   if(!mounted.current||auth.currentUser?.uid!==user.uid)return;
   release(slot);staged.current[slot]=blob;
   const url=URL.createObjectURL(blob);previews.current[slot]=url;
   setDraft(value=>({...value,[imageField[slot]]:url}));
   setMessage('Imagem preparada. Salve o perfil para confirmar.');
  }catch(error){if(mounted.current)setMessage(error instanceof Error?error.message:'Não foi possível preparar a imagem.');}
  finally{if(mounted.current)setPhotoBusy(false);}
 }
 async function savePublicProfile(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(disabled||!saved||auth.currentUser?.uid!==user.uid)return;
  const next={...draft,name:draft.name.trim().slice(0,80),bio:draft.bio.trim().slice(0,280),occupation:draft.occupation.trim().slice(0,90)};
  if(!next.name){setMessage('Informe o nome de exibição.');return;}
  setSaving(true);setMessage('');
  try{
   for(const slot of ['avatar','cover','background'] as const){
    const blob=staged.current[slot];if(!blob)continue;
    if(auth.currentUser?.uid!==user.uid)throw Error('SESSION_CHANGED');
    const target=ref(storage,'profile-images/' + user.uid + '/' + slot+'-'+crypto.randomUUID()+'.webp');
    await uploadBytes(target,blob,{contentType:'image/webp'});
    next[imageField[slot]]=await getDownloadURL(target);
   }
   if(auth.currentUser?.uid!==user.uid)throw Error('SESSION_CHANGED');
   if([next.photoUrl,next.coverUrl,next.backgroundUrl].some(url=>url.startsWith('blob:')))throw Error('INVALID_IMAGE');
   const fields={name:next.name,photoUrl:next.photoUrl,updatedAt:serverTimestamp()};
   const batch=writeBatch(db);
   batch.set(doc(db,'users',user.uid),fields,{merge:true});
   batch.set(doc(db,'users',user.uid,'public_profile','main'),{userId:user.uid,...fields,bio:next.bio,occupation:next.occupation,coverUrl:next.coverUrl,backgroundUrl:next.backgroundUrl},{merge:true});
   await batch.commit();
   if(!mounted.current||auth.currentUser?.uid!==user.uid)return;
   for(const slot of ['avatar','cover','background'] as const)release(slot);
   setDraft(next);setSaved(next);broadcastProfileUpdate(user,next.name,next.photoUrl);
   try{await updateProfile(user,{displayName:next.name,photoURL:next.photoUrl||null});setMessage('Apresentação salva.');}
   catch{setMessage('Apresentação salva. Não foi possível atualizar a foto e nome da sessão; tente salvar novamente.');}
  }catch(error){if(mounted.current)setMessage('Não foi possível confirmar o salvamento. Confira a conexão e tente novamente.');}
  finally{if(mounted.current)setSaving(false);}
 }
 if(loading)return <div className="flex min-h-52 items-center justify-center text-sm text-slate-400"><LoaderCircle className="mr-2 h-5 w-5 animate-spin"/>Carregando perfil…</div>;
 const dirty=JSON.stringify(draft)!==JSON.stringify(saved);
 return <section className="space-y-4" id="unified-public-profile-editor" aria-label="Perfil público">
  <header><h3 className="text-base font-black text-white">Minha apresentação</h3><p className="mt-1 text-sm text-slate-400">Personalize diretamente no cartão. Controle a visibilidade na Central Pessoal.</p></header>
  <form className="space-y-3" onSubmit={event=>void savePublicProfile(event)}>
   <PresentationVisualEditor {...draft} disabled={disabled} maxBio={280} requireName onText={(field,value)=>setDraft(current=>({...current,[field]:value}))} onImage={(slot,file)=>void prepare(slot,file)} onRemove={remove}>
    {googlePhoto&&<button type="button" disabled={disabled} onClick={selectGoogle} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm"><RotateCcw className="h-4 w-4"/>Usar foto do Google</button>}
   </PresentationVisualEditor>
   <button type="submit" disabled={disabled} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-black text-slate-950 disabled:opacity-50">{saving?<LoaderCircle className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>}Salvar perfil</button>
   {message&&<p role="status" className="text-xs text-slate-300">{message}</p>}
  </form>
  <details className="rounded-xl border border-slate-700 p-3"><summary className="cursor-pointer font-semibold">Comunidades e lojas</summary><div className="mt-3"><MultifunctionCardEditor key={user.uid} userId={user.uid} locked={disabled||dirty} presentationMode/></div></details>
  <PublicSocialAddressEditor key={user.uid} kind="profile" ownerId={user.uid}/>
  <ProfileTagImageImport key={'import-'+user.uid} uid={user.uid} disabled={disabled||dirty} current={draft} onImported={images=>{setDraft(value=>({...value,...images}));setSaved(value=>value?{...value,...images}:value);if(images.photoUrl)broadcastProfileUpdate(user,draft.name,images.photoUrl);}}/>
  <ProfileTagPresentationSync key={'sync-'+user.uid} userId={user.uid} disabled={disabled||dirty}/>
 </section>;
}
