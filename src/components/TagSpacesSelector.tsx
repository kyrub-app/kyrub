import {useEffect,useState} from 'react';
import {auth} from '../utils/firebase';
import {KYRUB_TAG_MODEL_LABELS,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
import {parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';
const endpoint='/api/health?transport=manage-kyrub-tag';
export function TagSpacesSelector({userId,urls,open,onOpen,disabled}:{userId:string;urls:string[];open:boolean;onOpen:(value:boolean)=>void;disabled:boolean}){
 const [tags,setTags]=useState<OwnedKyrubTag[]>([]);
 const [ids,setIds]=useState<string[]>([]);
 const [spaces,setSpaces]=useState<string[]>([]);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[message,setMessage]=useState('');
 const options=urls.filter(url=>['store','community'].includes(parsePublicDestinationUrl(url)?.kind??''));
 async function request(method:string,body?:unknown,signal?:AbortSignal){
  const user=auth.currentUser;if(!user||user.uid!==userId)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const response=await fetch(endpoint,{method,signal,cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw Error('TAG_REQUEST_FAILED');
  return response.json() as Promise<{tags:OwnedKyrubTag[];hasMore?:boolean}>;
 }
 useEffect(()=>{
  if(!open)return;
  const ctrl=new AbortController();
  setReady(false);setTags([]);setIds([]);setSpaces([]);setMessage('');
  void request('GET',undefined,ctrl.signal).then(result=>{
   if(ctrl.signal.aborted||auth.currentUser?.uid!==userId)return;
   setTags(result.tags.filter(t=>t.enabled&&!t.blocked));setReady(true);
   if(result.hasMore)setMessage('Exibindo as primeiras 100 unidades vinculadas.');
  }).catch(()=>{if(!ctrl.signal.aborted)setMessage('Não foi possível consultar suas Kyrub Tags. Feche e tente novamente.');});
  return()=>ctrl.abort();
 },[open,userId]);
 const toggle=(items:string[],value:string,checked:boolean)=>checked?[...items,value]:items.filter(x=>x!==value);
 async function save(){
  if(disabled||busy||!ready||!ids.length||!spaces.length)return;
  setBusy(true);setMessage('');
  try{await request('POST',{action:'add-card-spaces-to-tags',tagIds:ids,urls:spaces});setMessage('Espaços adicionados às Kyrub Tags selecionadas. Não é necessário regravar.');setIds([]);setSpaces([]);}
  catch{setMessage('Não foi possível atualizar. Confira unidades ativas, destinos públicos e limite de oito por unidade.');}
  finally{setBusy(false);}
 }
 return <div className="space-y-3 rounded-xl border border-slate-700 p-3">
  <h6 className="font-semibold">Amplie sua apresentação NFC</h6>
  {!open?<button type="button" className="min-h-11 rounded-xl border border-slate-700 px-3" disabled={disabled} onClick={()=>onOpen(true)}>Escolher Kyrub Tags</button>:<>
   <p className="text-sm text-slate-300">Escolha em quais Kyrub Tags deseja incluir os espaços públicos da sua apresentação.</p>
   {ready&&tags.length>0&&<>
    <button type="button" aria-expanded={expanded} className="min-h-11 w-full rounded-xl border border-slate-700 px-3 text-left" onClick={()=>setExpanded(v=>!v)}>{ids.length?ids.length+' selecionada(s)':'Selecionar Kyrub Tags'} <span aria-hidden="true">{expanded?'▴':'▾'}</span></button>
    {expanded&&<div className="space-y-2 rounded-xl border border-slate-700 p-3">
      <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={ids.length===tags.length} disabled={busy} onChange={e=>setIds(e.target.checked?tags.map(t=>t.id):[])}/>Selecionar todas</label>
      {tags.map(tag=><label key={tag.id} className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={ids.includes(tag.id)} disabled={busy} onChange={e=>setIds(current=>toggle(current,tag.id,e.target.checked))}/><span>{tag.nickname||KYRUB_TAG_MODEL_LABELS[tag.model]} · {tag.id.slice(-8)}</span></label>)}
    </div>}
    <p className="font-medium">O que deseja incluir?</p>
    {options.map(url=><label key={url} className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={spaces.includes(url)} disabled={busy} onChange={e=>setSpaces(current=>toggle(current,url,e.target.checked))}/><span className="break-all">{parsePublicDestinationUrl(url)?.kind==='store'?'Loja':'Comunidade'} · {parsePublicDestinationUrl(url)?.identifier}</span></label>)}
    <button type="button" disabled={disabled||busy||!ids.length||!spaces.length} onClick={()=>void save()} className="min-h-11 w-full rounded-xl bg-[#F47825] px-3 font-bold text-[#121A17] disabled:opacity-50">{busy?'Atualizando…':'Atualizar '+(ids.length>1?ids.length+' Kyrub Tags':'Kyrub Tag')}</button>
   </>}
   {ready&&!tags.length&&<p className="text-sm text-slate-300">Nenhuma Kyrub Tag ativa disponível.</p>}
   {!ready&&!message&&<p role="status">Consultando unidades…</p>}
   <button type="button" disabled={busy} onClick={()=>onOpen(false)} className="min-h-11 underline">Agora não</button>
   {message&&<p role="status" className="text-sm text-slate-300">{message}</p>}
  </>}
 </div>;
}
