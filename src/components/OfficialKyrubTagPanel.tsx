import {useEffect,useRef,useState} from 'react';
import {doc,updateDoc,serverTimestamp} from 'firebase/firestore';
import {UserRound,Store,Users,Link,Check,Eye} from 'lucide-react';
import {PublicSocialAddressEditor} from './PublicSocialAddressEditor';
import {auth,db} from '../utils/firebase';
import {isTagId,tagUrl,KYRUB_TAG_MODEL_LABELS,buildTagExternalUrl,parseTagExternalUrl,type TagDestinationCatalog,type TagDestinationOption,type TagExternalKind,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
const CARD_LIMIT=8;
const base='/api/health?transport=manage-kyrub-tag';
const btn='min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50';
export function OfficialKyrubTagPanel({userId,initialTagId}:{userId:string;initialTagId?:string}){
 const [tags,setTags]=useState<OwnedKyrubTag[]>([]),[id,setId]=useState(''),[code,setCode]=useState(''),[selected,setSelected]=useState(''),[urls,setUrls]=useState<string[]>([]),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[notice,setNotice]=useState('');
 const [catalog,setCatalog]=useState<TagDestinationCatalog|null>(null),[catalogError,setCatalogError]=useState(false),[revision,setRevision]=useState(0),[filter,setFilter]=useState(''),[externalKind,setExternalKind]=useState<TagExternalKind>('whatsapp'),[externalValue,setExternalValue]=useState(''),[added,setAdded]=useState<TagDestinationOption[]>([]),[privacyConfirm,setPrivacyConfirm]=useState(false);
 const lock=useRef(false);
 async function request(method:string,tagId='',body?:unknown,signal?:AbortSignal,view=''){
  const user=auth.currentUser;if(!user||user.uid!==userId)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const res=await fetch(base+(tagId?'&id='+encodeURIComponent(tagId):'')+(view?'&view='+view:''),{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});
  if(!res.ok)throw Error('TAG_REQUEST_FAILED');return res.json();
 }
 useEffect(()=>{const ctrl=new AbortController();setReady(false);setTags([]);setCode('');setSelected('');
 void request('GET',initialTagId??'',undefined,ctrl.signal).then(data=>{if(!ctrl.signal.aborted){if(initialTagId){setTags([data]);setSelected(data.id);setUrls(data.urls);}else{setTags(data.tags);if(data.tags.length===1){setSelected(data.tags[0].id);setUrls(data.tags[0].urls);}}setReady(true);if(data.hasMore)setNotice('Exibindo os primeiros 100 dispositivos.');}}).catch(()=>{if(!ctrl.signal.aborted)setNotice('Não foi possível consultar os dispositivos oficiais.');});return()=>ctrl.abort();},[userId,initialTagId]);
 useEffect(()=>{
  const ctrl=new AbortController();setCatalog(null);setCatalogError(false);setAdded([]);setFilter('');setPrivacyConfirm(false);setExternalValue('');
  if(selected)void request('GET',selected,undefined,ctrl.signal,'destinations').then(data=>{if(!ctrl.signal.aborted)setCatalog(data);}).catch(()=>{if(!ctrl.signal.aborted)setCatalogError(true);});
  return()=>ctrl.abort();
 },[userId,selected,revision]);
 const apply=(tag:OwnedKyrubTag)=>{setTags(current=>[...current.filter(t=>t.id!==tag.id),tag]);setSelected(tag.id);setUrls(tag.urls);};
 async function claim(){
  if(busy||!ready||!isTagId(id)||!isTagId(code))return;
  setBusy(true);setNotice('');
  try{apply(await request('POST',id,{action:'claim',code}));setId('');setNotice('Vínculo definitivo realizado. Escolha os destinos a publicar.');}catch{setNotice('Não foi possível vincular. Confira o código e a disponibilidade da unidade.');}finally{setCode('');setBusy(false);}
 }
 async function configure(){
  if(lock.current||busy||!selected||!catalog||urls.length<1)return;lock.current=true;setBusy(true);
  try{apply(await request('POST',selected,{action:'configure',urls}));setNotice('Sua Kyrub Tag está publicada!');}catch{setNotice('Não foi possível publicar. Alguns destinos podem ter mudado. Atualize a lista e tente novamente.');}finally{lock.current=false;setBusy(false);}
 }
 async function disable(){
  if(busy||!selected)return;setBusy(true);
  try{apply(await request('DELETE',selected));setNotice('Acesso público desta unidade desativado. O vínculo permanece.');}catch{setNotice('Não foi possível desativar.');}finally{setBusy(false);}
 }
 const tag=tags.find(t=>t.id===selected);
 const options=[...(catalog?.options??[]),...added.filter(o=>!catalog?.options.some(c=>c.url===o.url))];
 const selectedOptions=urls.map(url=>options.find(o=>o.url===url)??{url,name:'Destino indisponível — remova para continuar'});
 const toggle=(url:string)=>{setNotice('');setUrls(current=>current.includes(url)?current.filter(x=>x!==url):current.length<CARD_LIMIT?[...current,url]:current);};
 function addExternal(){
  const url=buildTagExternalUrl(externalKind,externalValue),link=parseTagExternalUrl(url);
  if(!link){setNotice('Informe um '+(externalKind==='whatsapp'?'número com DDI e DDD':'@ de Instagram')+' válido.');return;}
  if(urls.length>=CARD_LIMIT&&!urls.includes(link.url)){setNotice('Limite de oito destinos atingido.');return;}
  setAdded(current=>current.some(o=>o.url===link.url)?current:[...current,link]);
  setUrls(current=>current.includes(link.url)?current:[...current,link.url]);setExternalValue('');setNotice('');
 }
 async function optInProfile(){
  if(!privacyConfirm||busy||auth.currentUser?.uid!==userId)return;
  setBusy(true);
  try{await updateDoc(doc(db,'users',userId),{isProfileVisible:true,updatedAt:serverTimestamp()});setRevision(v=>v+1);setNotice('Perfil visível. Agora escolha seu nome público.');}
  catch{setNotice('Não foi possível atualizar a visibilidade do perfil.');}finally{setBusy(false);}
 }
 const filtered=(kind:string)=>options.filter(o=>o.kind===kind&&(!filter||o.name.toLocaleLowerCase('pt-BR').includes(filter.toLocaleLowerCase('pt-BR'))));
 const optionButton=(o:TagDestinationOption)=> <button key={o.url} type="button" aria-pressed={urls.includes(o.url)} disabled={busy||(!urls.includes(o.url)&&urls.length>=CARD_LIMIT)} onClick={()=>toggle(o.url)} className={btn+' flex w-full items-center justify-between text-left '+(urls.includes(o.url)?'border-orange-500 bg-orange-500/10':'')}><span>{o.name}</span><span>{urls.includes(o.url)?<Check className="h-5 w-5 text-orange-300"/>:'+'}</span></button>;
 return <section className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950 p-4">
 <h5 className="font-bold text-white">Kyrub Tag oficial</h5><p className="text-sm text-slate-300">Cada unidade tem um vínculo definitivo e acesso público independente. Tags genéricas e cartões digitais continuam disponíveis acima.</p>
 {!initialTagId&&<><label className="block text-sm">Identificador da unidade<input className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={id} onChange={e=>setId(e.target.value.trim().toLowerCase())} maxLength={32} disabled={busy||!ready}/></label>
 <label className="block text-sm">Código secreto de ativação<input type="password" autoComplete="off" className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={code} onChange={e=>setCode(e.target.value.trim().toLowerCase())} maxLength={32} disabled={busy||!ready}/></label>
 <p className="text-xs text-slate-400">A vinculação é intransferível. O código é de uso único. Nenhum dado pessoal será divulgado automaticamente.</p>
 <button type="button" className={btn} disabled={busy||!ready||!isTagId(id)||!isTagId(code)} onClick={()=>void claim()}>Vincular definitivamente</button></>}
 <h6 className="text-sm font-bold">Minhas unidades oficiais</h6>
 {tags.map(t=><button key={t.id} type="button" className={btn+' block w-full text-left'} disabled={busy} onClick={()=>{setSelected(t.id);setUrls(t.urls);}}>{KYRUB_TAG_MODEL_LABELS[t.model]} · {t.id.slice(-8)} · {t.enabled?'Pública':'Reservada'}</button>)}
 {tag&&<div className="space-y-4 border-t border-slate-700 pt-4">
 <h6 className="text-lg font-bold">Personalize sua Kyrub Tag</h6><p className="text-sm text-slate-300">Escolha o que as pessoas verão ao aproximar o celular. Nenhum destino será divulgado até você salvar.</p>
 {!catalog?<div role="status">{catalogError?<><p>Não foi possível carregar os destinos.</p><button className={btn} onClick={()=>setRevision(v=>v+1)}>Tentar novamente</button></>: 'Carregando seus destinos…'}</div>:<>
 <section className="space-y-2 rounded-xl border border-slate-700 p-3"><h6 className="flex gap-2 font-bold"><UserRound className="h-5 w-5 text-orange-300"/>Meu perfil</h6>
 {options.filter(o=>o.kind==='profile').map(optionButton)}
 {!options.some(o=>o.kind==='profile')&&<><p className="text-sm text-slate-300">{catalog.profile.eligible?'Escolha seu nome público para compartilhar seu perfil.':'Seu perfil está privado. Você pode continuar sem compartilhá-lo.'}</p>
 {catalog.profile.eligible?<><PublicSocialAddressEditor kind="profile" ownerId={userId} onReserved={()=>setRevision(v=>v+1)}/><button type="button" className={btn} disabled={busy} onClick={()=>setRevision(v=>v+1)}>Atualizar perfil disponível</button></>:<>
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={privacyConfirm} onChange={e=>setPrivacyConfirm(e.target.checked)}/>Quero tornar meu perfil público no Kyrub.</label><button className={btn} type="button" disabled={!privacyConfirm||busy} onClick={()=>void optInProfile()}>Tornar meu perfil público</button></>}</>}
 </section>
 <label className="block text-sm">Buscar entre lojas e comunidades disponíveis<input className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Nome da loja ou comunidade"/></label>
 {(['store','community'] as const).map(kind=><section key={kind} className="space-y-2 rounded-xl border border-slate-700 p-3"><h6 className="flex gap-2 font-bold">{kind==='store'?<Store className="h-5 w-5 text-orange-300"/>:<Users className="h-5 w-5 text-orange-300"/>}{kind==='store'?'Lojas públicas':'Comunidades públicas'}</h6>{filtered(kind).length?filtered(kind).map(optionButton):<p className="text-sm text-slate-400">Nenhum destino disponível nesta lista.</p>}</section>)}
 <p className="text-xs text-slate-400">Lista inicial de destinos públicos, incluindo suas lojas publicadas. Atualize para buscar destinos recentes.</p>
 <section className="space-y-2 rounded-xl border border-slate-700 p-3"><h6 className="flex gap-2 font-bold"><Link className="h-5 w-5 text-orange-300"/>Redes sociais e contato</h6><p className="text-xs text-slate-300">Somente adicione seu próprio contato ou endereço autorizado. O número ou @ ficará público.</p><label className="block text-sm">Tipo<select className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={externalKind} disabled={busy} onChange={e=>{setExternalKind(e.target.value as TagExternalKind);setExternalValue('');}}><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option></select></label><label className="block text-sm">{externalKind==='whatsapp'?'Número com DDI e DDD':'Nome de usuário do Instagram'}<input value={externalValue} onChange={e=>setExternalValue(e.target.value)} className="mt-1 w-full rounded-xl bg-slate-900 p-3" inputMode={externalKind==='whatsapp'?'tel':'text'} maxLength={40} placeholder={externalKind==='whatsapp'?'+55 11 99999-9999':'@meunome'} disabled={busy}/></label><button type="button" className={btn} onClick={addExternal} disabled={busy||!externalValue.trim()}>Adicionar</button>{options.filter(o=>o.kind==='whatsapp'||o.kind==='instagram').map(optionButton)}</section>
 <section className="space-y-2 rounded-xl border border-orange-500/30 bg-slate-900 p-3"><h6 className="flex gap-2 font-bold"><Eye className="h-5 w-5 text-orange-300"/>Prévia · {urls.length}/8 destinos</h6>{selectedOptions.length?selectedOptions.map(o=><div key={o.url} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 p-3"><span className="min-w-0 break-words">{o.name}</span><button type="button" disabled={busy} className="text-sm text-orange-300" onClick={()=>toggle(o.url)}>Remover</button></div>):<p className="text-sm text-slate-400">Escolha pelo menos um destino.</p>}<p className="text-xs text-slate-400">Esta é uma prévia da seleção. Os links só ficam públicos quando salvos.</p></section>
 <button type="button" className="min-h-12 w-full rounded-xl bg-orange-500 p-3 font-bold text-slate-950 disabled:opacity-50" disabled={busy||!urls.length||selectedOptions.some(o=>!options.some(x=>x.url===o.url))} onClick={()=>void configure()}>Salvar minha Kyrub Tag</button>
 <button type="button" className={btn} disabled={busy} onClick={()=>setRevision(v=>v+1)}>Atualizar destinos</button>
 </>}
 <button type="button" className={btn} disabled={busy||!tag.enabled} onClick={()=>void disable()}>Desativar acesso público</button></div>}
 <p role="status" className="text-xs text-slate-300">{notice}</p></section>;
}
