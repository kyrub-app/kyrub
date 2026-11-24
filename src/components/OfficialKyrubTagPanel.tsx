import {useEffect,useRef,useState} from 'react';
import {doc,updateDoc,serverTimestamp} from 'firebase/firestore';
import {UserRound,Store,Users,MessageCircle,Instagram,Check,Eye} from 'lucide-react';
import {KyrubTagDestinationRow} from './KyrubTagDestinationRow';
import {PromotionalKyrubTagEditor} from './PromotionalKyrubTagEditor';
import {PublicSocialAddressEditor} from './PublicSocialAddressEditor';
import {auth,db} from '../utils/firebase';
import {isTagId,KYRUB_TAG_MODEL_LABELS,buildTagExternalUrl,parseTagExternalUrl,type TagDestinationCatalog,type TagDestinationOption,type TagExternalKind,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
const CARD_LIMIT=8;
const base='/api/health?transport=manage-kyrub-tag';
const btn='min-h-11 rounded-xl border border-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50';
export function OfficialKyrubTagPanel({userId,initialTagId}:{userId:string;initialTagId?:string}){
 const [tags,setTags]=useState<OwnedKyrubTag[]>([]),[id,setId]=useState(''),[code,setCode]=useState(''),[selected,setSelected]=useState(''),[urls,setUrls]=useState<string[]>([]),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[notice,setNotice]=useState('');
 const [catalog,setCatalog]=useState<TagDestinationCatalog|null>(null),[catalogError,setCatalogError]=useState(false),[revision,setRevision]=useState(0),[filter,setFilter]=useState(''),[externalValues,setExternalValues]=useState<Record<TagExternalKind,string>>({whatsapp:'',instagram:''}),[added,setAdded]=useState<TagDestinationOption[]>([]),[privacyConfirm,setPrivacyConfirm]=useState(false);
 const [lookupUrl,setLookupUrl]=useState(''),[lookupBusy,setLookupBusy]=useState(false),[pilotRecovered,setPilotRecovered]=useState(false),[reload,setReload]=useState(0);
 const [nickname,setNickname]=useState('');
 const lock=useRef(false);
 const selectedIsPromotional=tags.find(t=>t.id===selected)?.distribution==='promotional';
 async function request(method:string,tagId='',body?:unknown,signal?:AbortSignal,view=''){
  const user=auth.currentUser;if(!user||user.uid!==userId)throw Error('AUTH_REQUIRED');
  const token=await user.getIdToken();
  const res=await fetch(base+(tagId?'&id='+encodeURIComponent(tagId):'')+(view?'&view='+view:''),{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});
  if(!res.ok)throw Error('TAG_REQUEST_FAILED');return res.json();
 }
 useEffect(()=>{const ctrl=new AbortController();setReady(false);setTags([]);setCode('');setSelected('');setPilotRecovered(false);
 void request('GET',initialTagId??'',undefined,ctrl.signal).then(data=>{if(!ctrl.signal.aborted){if(initialTagId){setTags([data]);setSelected(data.id);setUrls(data.urls);}else{setTags(data.tags);setPilotRecovered(data.pilotRecovered===true);if(data.tags.length===1){setSelected(data.tags[0].id);setUrls(data.tags[0].urls);}}setReady(true);if(data.hasMore)setNotice('Exibindo os primeiros 100 dispositivos.');}}).catch(()=>{if(!ctrl.signal.aborted)setNotice('Não foi possível consultar suas Kyrub Tags. Atualize a lista para tentar novamente.');});return()=>ctrl.abort();},[userId,initialTagId,reload]);
 useEffect(()=>{setAdded([]);setExternalValues({whatsapp:'',instagram:''});},[userId,selected]);
 useEffect(()=>{
  const ctrl=new AbortController();setCatalog(null);setCatalogError(false);setFilter('');setPrivacyConfirm(false);
  if(selected&&!selectedIsPromotional)void request('GET',selected,undefined,ctrl.signal,'destinations').then(data=>{if(!ctrl.signal.aborted)setCatalog(data);}).catch(()=>{if(!ctrl.signal.aborted)setCatalogError(true);});
  return()=>ctrl.abort();
 },[userId,selected,selectedIsPromotional,revision]);
 const apply=(tag:OwnedKyrubTag)=>{setTags(current=>[...current.filter(t=>t.id!==tag.id),tag]);setSelected(tag.id);setUrls(tag.urls);};
 async function findOwnedTag(){
  const candidate=lookupUrl.trim().toLowerCase();
  const match=/^https:\/\/(?:www\.)?kyrub\.com\/tag\/([a-f0-9]{32})\/?$/.exec(candidate);
  const target=isTagId(candidate)?candidate:match?.[1];
  if(!target||lookupBusy||busy)return;
  setLookupBusy(true);setNotice('');
  try{
   const found=await request('GET',target) as OwnedKyrubTag;
   if(found.id!==target||!isTagId(found.id))throw Error('TAG_INVALID');
   apply(found);setLookupUrl('');setNotice('Unidade localizada e vinculada à sua conta. Abra o gerenciamento para personalizar.');
  }catch{setNotice('Não foi possível localizar uma unidade vinculada a esta sessão. Confira o endereço e a conta autenticada.');}
  finally{setLookupBusy(false);}
 }
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
 useEffect(()=>{setNickname(tag?.nickname??'');},[tag?.id,tag?.nickname]);
 async function renameTag(){
  if(!tag||busy||lock.current)return;
  lock.current=true;setBusy(true);setNotice('');
  try{apply(await request('POST',tag.id,{action:'rename-tag',nickname}));setNotice('Apelido privado salvo.');}
  catch{setNotice('Não foi possível salvar o apelido.');}
  finally{lock.current=false;setBusy(false);}
 }
 const options=[...(catalog?.options??[]),...added.filter(o=>!catalog?.options.some(c=>c.url===o.url))];
 const selectedOptions=urls.map(url=>options.find(o=>o.url===url)??{url,name:'Destino indisponível — remova para continuar'});
 const toggle=(url:string)=>{setNotice('');setUrls(current=>current.includes(url)?current.filter(x=>x!==url):current.length<CARD_LIMIT?[...current,url]:current);};
 function addExternal(externalKind:TagExternalKind){
  const url=buildTagExternalUrl(externalKind,externalValues[externalKind]),link=parseTagExternalUrl(url);
  if(!link){setNotice('Informe um '+(externalKind==='whatsapp'?'número com DDI e DDD':'@ de Instagram')+' válido.');return;}
  if(urls.length>=CARD_LIMIT&&!urls.includes(link.url)){setNotice('Limite de oito destinos atingido.');return;}
  setAdded(current=>current.some(o=>o.url===link.url)?current:[...current,link]);
  setUrls(current=>current.includes(link.url)?current:[...current,link.url]);setExternalValues(prev=>({...prev,[externalKind]:''}));setNotice('');
 }
 async function optInProfile(){
  if(!privacyConfirm||busy||auth.currentUser?.uid!==userId)return;
  setBusy(true);
  try{await updateDoc(doc(db,'users',userId),{isProfileVisible:true,updatedAt:serverTimestamp()});setRevision(v=>v+1);setNotice('Perfil visível. Agora escolha seu nome público.');}
  catch{setNotice('Não foi possível atualizar a visibilidade do perfil.');}finally{setBusy(false);}
 }
 const filtered=(kind:string)=>options.filter(o=>o.kind===kind&&(!filter||o.name.toLocaleLowerCase('pt-BR').includes(filter.toLocaleLowerCase('pt-BR'))));
 const optionButton=(o:TagDestinationOption)=> <button key={o.url} type="button" aria-pressed={urls.includes(o.url)} disabled={busy||(!urls.includes(o.url)&&urls.length>=CARD_LIMIT)} onClick={()=>toggle(o.url)} className={btn+' flex w-full items-center justify-between text-left '+(urls.includes(o.url)?'border-orange-500 bg-orange-500/10':'')}><span>{o.name}</span><span>{urls.includes(o.url)?<Check className="h-5 w-5 text-orange-300"/>:'+'}</span></button>;
 return <section className={initialTagId?"space-y-4 rounded-[24px] bg-[#121A17] p-5 text-[#F5F5F3]":"space-y-4 rounded-2xl border border-[#34443B] bg-[#121A17] p-4 text-[#F5F5F3]"}>
 {!initialTagId&&<><h5 className="font-bold text-white">Minhas Kyrub Tags</h5><p className="text-sm text-slate-300">Gerencie seus adesivos promocionais e produtos oficiais protegidos. Cada unidade tem acesso público independente.</p></>}
 {!initialTagId&&<details className="rounded-xl border border-slate-700 p-3"><summary className="cursor-pointer text-sm font-medium">Vincular produto protegido com código de ativação</summary><label className="block text-sm">Identificador da unidade<input className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={id} onChange={e=>setId(e.target.value.trim().toLowerCase())} maxLength={32} disabled={busy||!ready}/></label>
 <label className="block text-sm">Código secreto de ativação<input type="password" autoComplete="off" className="mt-1 w-full rounded-xl bg-slate-900 p-3" value={code} onChange={e=>setCode(e.target.value.trim().toLowerCase())} maxLength={32} disabled={busy||!ready}/></label>
 <p className="text-xs text-slate-400">A vinculação é intransferível. O código é de uso único. Nenhum dado pessoal será divulgado automaticamente.</p>
 <button type="button" className={btn} disabled={busy||!ready||!isTagId(id)||!isTagId(code)} onClick={()=>void claim()}>Vincular definitivamente</button></details>}
 {!initialTagId&&<h6 className="text-sm font-bold">Minhas unidades vinculadas</h6>}
 {!initialTagId&&tags.map(t=><button key={t.id} type="button" className={btn+' block w-full text-left'} disabled={busy} onClick={()=>{setSelected(t.id);setUrls(t.urls);}}>{t.nickname||KYRUB_TAG_MODEL_LABELS[t.model]} · {t.id.slice(-8)} · {t.distribution==='promotional'?'Promocional · '+(t.blocked?'Bloqueada':t.enabled?'Pública':'Não publicada'):t.enabled?'Pública':'Vinculada · não publicada'}</button>)}
 {!initialTagId&&pilotRecovered&&<p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">A unidade experimental foi localizada por uma leitura direta e segura. A consulta geral de dispositivos precisa ser verificada; sua titularidade não foi alterada.</p>}
 {!initialTagId&&!ready&&notice&&<button type="button" className="text-sm underline" disabled={busy||lookupBusy} onClick={()=>{setNotice('');setReload(v=>v+1);}}>Tentar consultar novamente</button>}
 {!initialTagId&&ready&&tags.length===0&&<div className="rounded-xl border border-dashed border-[#34443B] p-3 text-sm text-slate-300"><p>Nenhuma Kyrub Tag vinculada a esta conta foi encontrada. Se acabou de ativar uma unidade, confira se entrou com o mesmo e-mail e atualize a lista.</p><button type="button" className="mt-2 underline" disabled={busy||lookupBusy} onClick={()=>setReload(v=>v+1)}>Atualizar lista</button></div>}
 {!initialTagId&&<details className="rounded-xl border border-[#34443B] p-3"><summary className="cursor-pointer text-sm font-medium">Não encontrou uma tag já vinculada?</summary><p className="mt-3 text-xs text-slate-300">Cole o endereço kyrub.com/tag/... da sua unidade. A verificação é feita pelo servidor e só abre unidades pertencentes à conta autenticada.</p><label className="mt-3 block text-sm">Endereço da Kyrub Tag<input type="url" value={lookupUrl} onChange={e=>setLookupUrl(e.target.value)} placeholder="https://kyrub.com/tag/..." className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3 text-sm" autoComplete="off" maxLength={200} disabled={busy||lookupBusy}/></label><button type="button" className={btn+' mt-3'} disabled={busy||lookupBusy||(!isTagId(lookupUrl.trim())&&!/^https:\/\/(?:www\.)?kyrub\.com\/tag\/[a-f0-9]{32}\/?$/i.test(lookupUrl.trim()))} onClick={()=>void findOwnedTag()}>{lookupBusy?'Consultando…':'Verificar minha unidade'}</button></details>}
 {tag&&<div className="space-y-2 rounded-xl border border-[#34443B] p-3">
  <label className="block text-sm">Apelido privado do dispositivo
   <input value={nickname} maxLength={48} disabled={busy} placeholder="Ex.: Meu capacete" onChange={e=>setNickname(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 p-3"/>
  </label>
  <p className="text-xs text-slate-400">Somente você verá este apelido.</p>
  <button type="button" className={btn} disabled={busy||nickname.trim()===(tag.nickname??'')} onClick={()=>void renameTag()}>Salvar apelido</button>
 </div>}
 {tag?.distribution==='promotional'&&<PromotionalKyrubTagEditor key={tag.id} initial={tag} />}
 {tag&&tag.distribution!=='promotional'&&<div className="space-y-4" key={tag.id}>
 <p className="text-sm font-medium uppercase tracking-wide text-[#F47825]">Kyrub Tag · {KYRUB_TAG_MODEL_LABELS[tag.model]}</p>
 <h6 className="text-[26px] font-bold leading-tight text-[#F5F5F3]">Personalize sua Kyrub Tag</h6>
 <p className="text-lg leading-snug text-[#F5F5F3]">Escolha o que deseja compartilhar.</p>
 {!catalog&&<div role="status" className="text-sm text-slate-300">{catalogError?<><p>Não foi possível carregar os destinos.</p><button type="button" className={btn} onClick={()=>setRevision(v=>v+1)}>Tentar novamente</button></>:'Carregando seus destinos…'}</div>}
 <div className="space-y-3" data-testid="tag-destination-rows">
 <KyrubTagDestinationRow label="Meu perfil" icon={UserRound} disabled={busy}>
 {catalog?<>{options.filter(o=>o.kind==='profile').map(optionButton)}
 {!options.some(o=>o.kind==='profile')&&<><p className="text-sm text-slate-300">{catalog.profile.eligible?'Escolha seu nome público para compartilhar seu perfil.':'Seu perfil está privado. Você pode continuar sem compartilhá-lo.'}</p>
 {catalog.profile.eligible?<><PublicSocialAddressEditor kind="profile" ownerId={userId} onReserved={()=>setRevision(v=>v+1)}/><button type="button" className={btn} disabled={busy} onClick={()=>setRevision(v=>v+1)}>Atualizar perfil disponível</button></>:<>
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={privacyConfirm} onChange={e=>setPrivacyConfirm(e.target.checked)}/>Quero tornar meu perfil público no Kyrub.</label><button className={btn} type="button" disabled={!privacyConfirm||busy} onClick={()=>void optInProfile()}>Tornar meu perfil público</button></>}</>}</>:<p className="text-sm text-slate-400">Os destinos precisam ser carregados.</p>}
 </KyrubTagDestinationRow>
 <KyrubTagDestinationRow label="Lojas e comunidades" icon={Store} disabled={busy}>
 {catalog?<><label className="block text-sm">Buscar lojas e comunidades<input className="mt-1 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Nome da loja ou comunidade"/></label>
 {(['store','community'] as const).map(kind=><section key={kind} className="space-y-2"><h6 className="flex gap-2 font-bold">{kind==='store'?<Store className="h-5 w-5 text-[#F47825]"/>:<Users className="h-5 w-5 text-[#F47825]"/>}{kind==='store'?'Lojas públicas':'Comunidades públicas'}</h6>{filtered(kind).length?filtered(kind).map(optionButton):<p className="text-sm text-slate-400">Nenhum destino disponível nesta lista.</p>}</section>)}
 <button type="button" className={btn} disabled={busy} onClick={()=>setRevision(v=>v+1)}>Atualizar destinos</button></>:<p className="text-sm text-slate-400">Os destinos precisam ser carregados.</p>}
 </KyrubTagDestinationRow>
 {(['whatsapp','instagram'] as const).map(kind=><KyrubTagDestinationRow key={kind} label={kind==='whatsapp'?'WhatsApp':'Instagram'} icon={kind==='whatsapp'?MessageCircle:Instagram} disabled={busy}>
 <p className="text-sm text-slate-300">Somente adicione seu próprio contato ou endereço autorizado. {kind==='whatsapp'?'O número ficará público.':'O @ ficará público.'}</p>
 <label className="block text-sm">{kind==='whatsapp'?'Número com DDI e DDD':'Nome de usuário do Instagram'}<input value={externalValues[kind]} onChange={e=>setExternalValues(prev=>({...prev,[kind]:e.target.value}))} className="mt-1 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" inputMode={kind==='whatsapp'?'tel':'text'} maxLength={40} placeholder={kind==='whatsapp'?'+55 11 99999-9999':'@meunome'} disabled={busy}/></label>
 <button type="button" className={btn} onClick={()=>addExternal(kind)} disabled={busy||!externalValues[kind].trim()}>Adicionar</button>
 {options.filter(o=>o.kind===kind).map(optionButton)}
 </KyrubTagDestinationRow>)}
 </div>
 <section className="space-y-3 border-t border-[#34443B] pt-4" aria-label="Prévia dos destinos selecionados"><h6 className="flex items-center gap-2 text-base font-bold"><Eye aria-hidden="true" className="h-5 w-5 shrink-0"/>Prévia dos destinos selecionados</h6>
 {selectedOptions.length?selectedOptions.map(o=><div key={o.url} className="flex items-center justify-between gap-2 rounded-xl border border-[#34443B] p-3"><span className="min-w-0 break-words">{o.name}{parseTagExternalUrl(o.url)&&<span className="block text-xs text-slate-300">{o.url.replace('https://wa.me/','+').replace('https://www.instagram.com/','@').replace(/\/$/,'')}</span>}</span><button type="button" disabled={busy} className="text-sm text-[#F47825]" onClick={()=>toggle(o.url)}>Remover</button></div>):null}
 {selectedOptions.length>0&&<p className="text-xs text-slate-400">{urls.length}/8 destinos · Só ficam públicos quando salvos.</p>}
 </section>
 <button type="button" className="min-h-[62px] w-full rounded-[18px] bg-[#F47825] px-4 py-3 text-lg font-semibold text-[#121A17] disabled:opacity-60" disabled={busy||!catalog||!urls.length||selectedOptions.some(o=>!options.some(x=>x.url===o.url))} onClick={()=>void configure()}>Salvar minha Kyrub Tag</button>
 {tag.enabled&&<button type="button" className="block mx-auto py-2 text-sm text-slate-300 underline disabled:opacity-50" disabled={busy} onClick={()=>void disable()}>Desativar acesso público</button>}
 </div>}
 {!tag&&initialTagId&&!ready&&<p role="status" className="text-sm text-slate-300">Carregando sua Kyrub Tag…</p>}
 {notice&&<p role="status" className="text-sm text-slate-300">{notice}</p>}</section>;
}
