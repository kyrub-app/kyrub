import {useEffect,useRef,useState} from 'react';
import {doc,getDocFromServer} from 'firebase/firestore';
import {auth,db} from '../utils/firebase';
import {KYRUB_TAG_MODEL_LABELS,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
import {loadOwnedProfileImageFile,ownedProfileImagePath,uploadPromotionalTagImage} from '../utils/kyrubTagMedia';
type Snapshot={name:string;occupation:string;bio:string;photoUrl:string;coverUrl:string};
type Field='text'|'avatar'|'cover';
const endpoint='/api/health?transport=manage-kyrub-tag';
export function ProfileTagPresentationSync({userId,disabled}:{userId:string;disabled:boolean}){
 const [open,setOpen]=useState(false),[expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [source,setSource]=useState<Snapshot|null>(null),[tags,setTags]=useState<OwnedKyrubTag[]>([]),[ids,setIds]=useState<string[]>([]),[fields,setFields]=useState<Field[]>([]);
 const lock=useRef(false);
 async function request(body?:unknown,signal?:AbortSignal){
  const user=auth.currentUser;if(!user||user.uid!==userId)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const res=await fetch(endpoint,{method:body?'POST':'GET',signal,cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(!res.ok)throw Error('SYNC_UNAVAILABLE');
  return res.json() as Promise<{tags:OwnedKyrubTag[]}>;
 }
 useEffect(()=>{
  if(!open)return;
  const ctrl=new AbortController();setNotice('');setSource(null);setTags([]);setIds([]);setFields([]);setExpanded(false);
  void Promise.all([getDocFromServer(doc(db,'users',userId,'public_profile','main')),request(undefined,ctrl.signal)]).then(([profile,result])=>{
   if(ctrl.signal.aborted||auth.currentUser?.uid!==userId)return;
   if(!profile.exists()){setNotice('Salve seu perfil antes de sincronizar.');return;}
   const read=(key:string)=>typeof profile.get(key)==='string'?profile.get(key) as string:'';
   setSource({name:read('name'),occupation:read('occupation'),bio:read('bio'),photoUrl:read('photoUrl'),coverUrl:read('coverUrl')});
   setTags(result.tags.filter(t=>t.distribution==='promotional'&&t.enabled&&!t.blocked));
  }).catch(()=>{if(!ctrl.signal.aborted)setNotice('Não foi possível consultar a apresentação. Feche e tente novamente.');});
  return()=>ctrl.abort();
 },[open,userId]);
 async function save(){
  if(!source||!ids.length||!fields.length||lock.current||disabled)return;
  lock.current=true;setBusy(true);setNotice('');
  try{
   const slots=(['avatar','cover'] as const).filter(slot=>fields.includes(slot));
   const files=await Promise.all(slots.map(slot=>loadOwnedProfileImageFile(userId,slot==='avatar'?source.photoUrl:source.coverUrl,slot)));
   const media:Record<string,Record<string,string>>={};
   for(const id of ids){
    if(auth.currentUser?.uid!==userId)throw Error('AUTH_REQUIRED');
    const item:Record<string,string>={};
    for(const [i,slot] of slots.entries()){
     const uploaded=await uploadPromotionalTagImage(files[i],id,slot);
     URL.revokeObjectURL(uploaded.previewUrl);item[slot+'Path']=uploaded.path;
    }
    if(slots.length)media[id]=item;
   }
   await request({action:'sync-profile-presentation',input:{tagIds:ids,expected:source,fields,media}});
   setNotice('Apresentação atualizada somente nas Tags selecionadas.');setIds([]);setFields([]);
  }catch{setNotice('Não foi possível sincronizar. Nenhuma alteração parcial da apresentação foi publicada. Feche e confira o perfil e as Tags.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="space-y-3 rounded-xl border border-slate-700 p-3">
  <h4 className="font-semibold">Atualizar apresentação das Kyrub Tags</h4>
  {!open?<button type="button" disabled={disabled} className="min-h-11 rounded-xl border border-slate-700 px-3 text-sm" onClick={()=>setOpen(true)}>Escolher dispositivos e informações</button>:<>
   <p className="text-sm text-slate-300">Use os dados já salvos no perfil. As informações selecionadas ficarão públicas nas Tags escolhidas, independentemente da visibilidade futura do perfil.</p>
   {source&&tags.length>0&&<>
    <button type="button" disabled={busy} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)} className="min-h-11 w-full rounded-xl border border-slate-700 px-3 text-left">{ids.length?ids.length+' selecionada(s)':'Selecionar Kyrub Tags'} {expanded?'▴':'▾'}</button>
    {expanded&&<div className="space-y-2">
      <label className="flex min-h-10 gap-2 items-center"><input type="checkbox" disabled={busy} checked={ids.length===tags.length} onChange={e=>setIds(e.target.checked?tags.map(t=>t.id):[])}/>Selecionar todas</label>
      {tags.map(tag=><label key={tag.id} className="flex min-h-10 items-center gap-2"><input type="checkbox" disabled={busy} checked={ids.includes(tag.id)} onChange={e=>setIds(current=>e.target.checked?[...current,tag.id]:current.filter(id=>id!==tag.id))}/>{tag.nickname||KYRUB_TAG_MODEL_LABELS[tag.model]} · {tag.id.slice(-8)}</label>)}
    </div>}
    <div className="rounded-xl border border-slate-700 p-3 text-sm">
      <p className="font-semibold">{source.name}</p><p>{source.occupation}</p><p className="whitespace-pre-wrap">{source.bio}</p>
    </div>
    {(['text','avatar','cover'] as const).map(field=>{
     const available=field==='text'?source.name.length<=80:!!ownedProfileImagePath(userId,field==='avatar'?source.photoUrl:source.coverUrl,field);
     return <label key={field} className="flex min-h-10 gap-2 items-center text-sm"><input type="checkbox" checked={fields.includes(field)} disabled={busy||!available} onChange={e=>setFields(current=>e.target.checked?[...current,field]:current.filter(f=>f!==field))}/>{field==='text'?'Nome, atividade e biografia':field==='avatar'?'Foto de perfil':'Capa'}{!available?' (indisponível para copiar)':''}</label>;
    })}
    <p className="text-xs text-slate-400">Fotos externas, como a do Google, não são copiadas. Envie uma imagem própria para usar na Tag. SOS, destinos e titularidade não serão alterados.</p>
    <button type="button" disabled={busy||disabled||!ids.length||!fields.length} className="min-h-12 w-full rounded-xl bg-[#F47825] font-bold text-[#121A17] disabled:opacity-50" onClick={()=>void save()}>{busy?'Atualizando…':'Atualizar Tags selecionadas'}</button>
   </>}
   {source&&!tags.length&&<p>Nenhuma Tag promocional ativa disponível.</p>}
   {!source&&!notice&&<p role="status">Consultando apresentação e dispositivos…</p>}
   <button type="button" disabled={busy} onClick={()=>setOpen(false)} className="min-h-11 underline">Fechar</button>
   {notice&&<p role="status" className="text-sm">{notice}</p>}
  </>}
 </section>;
}
