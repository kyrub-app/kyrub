import {useEffect,useState} from 'react';
import {auth} from '../utils/firebase';
import type {OwnedKyrubTag} from '../../shared/kyrubTagContract';
import {availableTagImages,importTagProfileImages,PROFILE_IMPORT_LABELS,type ProfileImportSlot} from '../utils/profileTagImageImport';
type Images=Partial<Record<'photoUrl'|'coverUrl'|'backgroundUrl',string>>;
const field={avatar:'photoUrl',cover:'coverUrl',background:'backgroundUrl'} as const;
export function ProfileTagImageImport({uid,disabled,current,onImported}:{uid:string;disabled:boolean;current:Images;onImported:(images:Images)=>void}){
 const [open,setOpen]=useState(false),[tags,setTags]=useState<OwnedKyrubTag[]>([]),[id,setId]=useState(''),[slots,setSlots]=useState<ProfileImportSlot[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{
  if(!open)return;
  const controller=new AbortController();setReady(false);setNotice('');setTags([]);setId('');setSlots([]);
  const user=auth.currentUser;if(!user||user.uid!==uid)return;
  void user.getIdToken().then(token=>fetch('/api/health?transport=manage-kyrub-tag',{cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+token}})).then(async response=>{
   if(!response.ok)throw Error('TAG_LIST_UNAVAILABLE');
   const value=await response.json() as {tags:OwnedKyrubTag[]};
   if(!controller.signal.aborted&&auth.currentUser?.uid===uid)setTags(value.tags.filter(tag=>tag.distribution==='promotional'&&tag.enabled&&!tag.blocked&&availableTagImages(tag).length>0));
  }).catch(()=>{if(!controller.signal.aborted)setNotice('Não foi possível consultar suas Tags. Feche e tente novamente.');}).finally(()=>{if(!controller.signal.aborted)setReady(true);});
  return()=>controller.abort();
 },[open,uid]);
 const source=tags.find(tag=>tag.id===id);
 const available=availableTagImages(source).filter(slot=>!current[field[slot]]);
 async function save(){
  if(disabled||busy||!id||!slots.length||slots.some(slot=>!available.includes(slot)))return;
  setBusy(true);setNotice('');
  try{
   const result=await importTagProfileImages(uid,id,slots);
   if(auth.currentUser?.uid!==uid)return;
   onImported(result.images);setSlots([]);setNotice(Object.keys(result.images).length?'Imagens importadas para o perfil.':'As imagens selecionadas já estavam preenchidas. Nenhuma imagem foi substituída.');
  }catch{setNotice('Não foi possível confirmar a importação. Reabra o editor antes de tentar novamente.');}
  finally{setBusy(false);}
 }
 return <section className="space-y-2 rounded-xl border border-slate-700 p-3">
  <button type="button" disabled={disabled||busy} className="min-h-11 w-full text-left font-semibold" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Importar imagens de uma Kyrub Tag</button>
  {open&&<div className="space-y-2">
   <p className="text-xs text-slate-300">Copie apenas imagens para espaços vazios do perfil. As imagens poderão ser exibidas publicamente. Nenhum dado da Tag será alterado.</p>
   {!ready?<p role="status" className="text-sm">Consultando dispositivos…</p>:tags.length?<label className="block text-sm">Tag de origem<select value={id} disabled={disabled||busy} className="mt-1 min-h-11 w-full rounded-lg bg-slate-950 p-2" onChange={e=>{setId(e.target.value);setSlots([]);}}><option value="">Selecione</option>{tags.map(tag=><option key={tag.id} value={tag.id}>{tag.nickname||tag.presentation?.name||'Adesivo'} · {tag.id.slice(-8)}</option>)}</select></label>:<p className="text-sm">Nenhuma Tag ativa com imagens disponível.</p>}
   {id&&!available.length&&<p className="text-sm">Nenhum espaço vazio correspondente às imagens desta Tag. Para substituir, remova a imagem atual e salve o perfil antes.</p>}
   {available.map(slot=><label key={slot} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" disabled={disabled||busy} checked={slots.includes(slot)} onChange={e=>{const checked=e.target.checked;setSlots(value=>checked?[...value,slot]:value.filter(item=>item!==slot));}}/>{PROFILE_IMPORT_LABELS[slot]}</label>)}
   <button type="button" disabled={disabled||busy||!slots.length} className="min-h-11 w-full rounded-lg border border-orange-500 text-orange-300 disabled:opacity-50" onClick={()=>void save()}>{busy?'Importando…':'Importar imagens selecionadas'}</button>
   {notice&&<p role="status" className="text-xs">{notice}</p>}
  </div>}
 </section>;
}
