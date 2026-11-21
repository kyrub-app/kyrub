import {useEffect,useState} from 'react';
import {auth} from '../utils/firebase';
import {isTagId,tagUrl,KYRUB_TAG_MODEL_LABELS,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
const base='/api/health?transport=manage-kyrub-tag';
const btn='min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50';
export function OfficialKyrubTagPanel({userId}:{userId:string}){
 const [tags,setTags]=useState<OwnedKyrubTag[]>([]),[id,setId]=useState(''),[code,setCode]=useState(''),[selected,setSelected]=useState(''),[urls,setUrls]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[notice,setNotice]=useState('');
 async function request(method:string,tagId='',body?:unknown,signal?:AbortSignal){
  const user=auth.currentUser;if(!user||user.uid!==userId)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const res=await fetch(base+(tagId?'&id='+encodeURIComponent(tagId):''),{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});
  if(!res.ok)throw Error('TAG_REQUEST_FAILED');return res.json();
 }
 useEffect(()=>{const ctrl=new AbortController();setReady(false);setTags([]);setCode('');setSelected('');
 void request('GET','',undefined,ctrl.signal).then(data=>{if(!ctrl.signal.aborted){setTags(data.tags);setReady(true);if(data.hasMore)setNotice('Exibindo os primeiros 100 dispositivos.');}}).catch(()=>{if(!ctrl.signal.aborted)setNotice('Não foi possível consultar os dispositivos oficiais.');});return()=>ctrl.abort();},[userId]);
 const apply=(tag:OwnedKyrubTag)=>{setTags(current=>[...current.filter(t=>t.id!==tag.id),tag]);setSelected(tag.id);setUrls(tag.urls.join('\n'));};
 async function claim(){
  if(busy||!ready||!isTagId(id)||!isTagId(code))return;
  setBusy(true);setNotice('');
  try{apply(await request('POST',id,{action:'claim',code}));setId('');setNotice('Vínculo definitivo realizado. Escolha os destinos a publicar.');}catch{setNotice('Não foi possível vincular. Confira o código e a disponibilidade da unidade.');}finally{setCode('');setBusy(false);}
 }
 async function configure(){
  if(busy||!selected)return;setBusy(true);
  try{apply(await request('POST',selected,{action:'configure',urls:urls.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)}));setNotice('Acesso público atualizado nesta unidade.');}catch{setNotice('Não foi possível publicar. Confira os endereços públicos válidos.');}finally{setBusy(false);}
 }
 async function disable(){
  if(busy||!selected)return;setBusy(true);
  try{apply(await request('DELETE',selected));setNotice('Acesso público desta unidade desativado. O vínculo permanece.');}catch{setNotice('Não foi possível desativar.');}finally{setBusy(false);}
 }
 const tag=tags.find(t=>t.id===selected);
 return <section className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950 p-4">
 <h5 className="font-bold text-white">Kyrub Tag oficial</h5><p className="text-sm text-slate-300">Cada unidade tem um vínculo definitivo e acesso público independente. Tags genéricas e cartões digitais continuam disponíveis acima.</p>
 <label className="block text-sm">Identificador da unidade<input className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={id} onChange={e=>setId(e.target.value.trim().toLowerCase())} maxLength={32} disabled={busy||!ready}/></label>
 <label className="block text-sm">Código secreto de ativação<input type="password" autoComplete="off" className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={code} onChange={e=>setCode(e.target.value.trim().toLowerCase())} maxLength={32} disabled={busy||!ready}/></label>
 <p className="text-xs text-slate-400">A vinculação é intransferível. O código é de uso único. Nenhum dado pessoal será divulgado automaticamente.</p>
 <button type="button" className={btn} disabled={busy||!ready||!isTagId(id)||!isTagId(code)} onClick={()=>void claim()}>Vincular definitivamente</button>
 <h6 className="text-sm font-bold">Minhas unidades oficiais</h6>
 {tags.map(t=><button key={t.id} type="button" className={btn+' block w-full text-left'} disabled={busy} onClick={()=>{setSelected(t.id);setUrls(t.urls.join('\n'));}}>{KYRUB_TAG_MODEL_LABELS[t.model]} · {t.id.slice(-8)} · {t.enabled?'Pública':'Reservada'}</button>)}
 {tag&&<div className="space-y-3"><a href={'/tag/'+tag.id} className="block break-all text-orange-300 underline">{tagUrl(tag.id)}</a>
 <label className="block text-sm">Destinos públicos (um endereço completo por linha, até oito)<textarea value={urls} onChange={e=>setUrls(e.target.value)} rows={4} maxLength={1450} disabled={busy} className="mt-1 w-full rounded-xl bg-slate-900 p-3" placeholder="https://kyrub.com/kairubido/meu-perfil"/></label>
 <button type="button" className={btn} disabled={busy||!urls.trim()} onClick={()=>void configure()}>Salvar e publicar nesta unidade</button>
 <button type="button" className={btn} disabled={busy||!tag.enabled} onClick={()=>void disable()}>Desativar acesso público</button></div>}
 <p role="status" className="text-xs text-slate-300">{notice}</p></section>;
}
