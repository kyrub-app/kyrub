import {useEffect,useRef,useState} from 'react';
import {auth} from '../utils/firebase';
import {EMPTY_PROMOTIONAL_PRESENTATION,type PromotionalTagPresentation,type PromotionalSosContact} from '../../shared/kyrubTagPromotional';
import {loadPrivatePromotionalTagImage,uploadPromotionalTagImage} from '../utils/kyrubTagMedia';
import type {OwnedKyrubTag} from '../../shared/kyrubTagContract';
import {buildPublicDestinationUrl,parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';

export function PromotionalKyrubTagEditor({initial,oneTimeRecoveryCode,initialDraft}:{initial:OwnedKyrubTag;oneTimeRecoveryCode?:string|null;initialDraft?:PromotionalTagPresentation}){
 const [tag,setTag]=useState(initial);
 const [presentation,setPresentation]=useState<PromotionalTagPresentation>(initialDraft??initial.presentation??EMPTY_PROMOTIONAL_PRESENTATION);
 const [destinations,setDestinations]=useState(()=>Object.fromEntries((initialDraft?.destinations??initial.presentation?.destinations??[]).flatMap(url=>{const p=parsePublicDestinationUrl(url);return p&&p.kind!=='card'?[[p.kind,p.identifier]]:[];})) as Partial<Record<'profile'|'store'|'community',string>>);
 const [recoveryCode,setRecoveryCode]=useState(oneTimeRecoveryCode??'');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [coverPreview,setCoverPreview]=useState('');
 const [avatarPreview,setAvatarPreview]=useState('');
 const [uploading,setUploading]=useState(false);
 const previews=useRef<{cover:string;avatar:string}>({cover:'',avatar:''});
 const setPreview=(slot:'cover'|'avatar',url:string)=>{
  if(previews.current[slot].startsWith('blob:'))URL.revokeObjectURL(previews.current[slot]);
  previews.current[slot]=url;
  if(slot==='cover')setCoverPreview(url);else setAvatarPreview(url);
 };
 useEffect(()=>{
  let mounted=true;
  const initialPaths={cover:initial.presentation?.coverPath??'',avatar:initial.presentation?.avatarPath??''};
  for(const slot of ['cover','avatar'] as const)if(initialPaths[slot]){
   void loadPrivatePromotionalTagImage(initial.id,slot,initialPaths[slot]).then(url=>{
    if(!url)return;
    if(mounted)setPreview(slot,url);
    else URL.revokeObjectURL(url);
   }).catch(()=>{});
  }
  return()=>{mounted=false;for(const url of Object.values(previews.current))if(url.startsWith('blob:'))URL.revokeObjectURL(url);};
 // Initial owner record is stable for the editor lifetime.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[initial.id]);
 const set=(key:'name'|'occupation'|'about',value:string)=>setPresentation(current=>({...current,[key]:value}));
 const contacts=presentation.emergencyContacts??[];
 const emptyContact=():PromotionalSosContact=>({name:'',relationship:'',phone:'',whatsapp:false,shareInSos:false,consentConfirmed:false});
 function updateContact(index:number,patch:Partial<PromotionalSosContact>){
  setPresentation(current=>({...current,emergencyContacts:(current.emergencyContacts??[]).map((item,i)=>i===index?{...item,...patch}:item)}));
 }
 async function upload(slot:'cover'|'avatar',file:File|undefined){
  if(!file||busy||uploading||tag.blocked)return;
  setUploading(true);setNotice('');
  try{
   const result=await uploadPromotionalTagImage(file,tag.id,slot);
   setPresentation(current=>({...current,[slot==='cover'?'coverPath':'avatarPath']:result.path}));
   setPreview(slot,result.previewUrl);
   setNotice('Foto preparada. Toque em Salvar e publicar para atualizar seu cartão.');
  }catch(e){setNotice(e instanceof Error?e.message:'Não foi possível enviar esta foto.');}
  finally{setUploading(false);}
 }
 function removeImage(slot:'cover'|'avatar'){
  setPresentation(current=>({...current,[slot==='cover'?'coverPath':'avatarPath']:''}));
  setPreview(slot,'');
 }
 async function execute(action:'configure-promotional'|'block-promotional'|'unblock-promotional',extras:Record<string,unknown>={}){
  if(busy||!auth.currentUser)return;
  setBusy(true);setNotice('');
  try{
   const token=await auth.currentUser.getIdToken(true);
   const res=await fetch('/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(tag.id),{
    method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({action,...extras})
   });
   if(!res.ok)throw Error('TAG_FAILED');
   const updated=await res.json() as OwnedKyrubTag;
   if(updated.id!==tag.id||updated.distribution!=='promotional')throw Error('TAG_FAILED');
   setTag(updated);
   setNotice(action==='configure-promotional'?'Sua apresentação foi publicada.':action==='block-promotional'?'Sua tag foi bloqueada. Seu cartão não está mais público.':'Bloqueio removido. Revise e publique a apresentação para reativá-la.');
  }catch{setNotice('Não foi possível concluir. Confira sua sessão e tente novamente.');}
  finally{setBusy(false);}
 }
 async function rotateRecovery(){
  if(busy||!auth.currentUser)return;
  if(!window.confirm('Gerar um novo código de recuperação? O código antigo será invalidado. Guarde o novo em um local seguro.'))return;
  setBusy(true);setNotice('');
  try{
   const token=await auth.currentUser.getIdToken(true);
   const res=await fetch('/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(tag.id),{
    method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({action:'rotate-promotional-recovery'})
   });
   if(!res.ok)throw Error('TAG_FORBIDDEN');
   const result=await res.json() as {tag:OwnedKyrubTag;recoveryCode:string};
   if(result.tag.id!==tag.id||result.tag.distribution!=='promotional'||!/^[a-f0-9]{48}$/.test(result.recoveryCode))throw Error('TAG_INVALID');
   setTag(result.tag);setRecoveryCode(result.recoveryCode);
   setNotice('O código anterior foi invalidado. Guarde o novo código antes de sair desta tela.');
  }catch{setNotice('Não foi possível substituir o código. Confira sua sessão e tente novamente.');}
  finally{setBusy(false);}
 }
 return <section className="space-y-4 rounded-[24px] bg-[#121A17] p-5 text-[#F5F5F3]">
  <header className="space-y-1">
   <p className="text-sm font-semibold uppercase tracking-wide text-[#F47825]">Kyrub Tag · Adesivo promocional</p>
   <h1 className="text-2xl font-bold">Sua apresentação, do seu jeito.</h1>
   <p className="text-sm text-slate-300">Edite as informações que deseja compartilhar. Sua identidade é protegida pelo e-mail verificado da conta.</p>
  </header>
  <div className="rounded-xl border border-[#34443B] p-3 text-sm">
   <strong>Estado: {tag.blocked?'Bloqueada por segurança':tag.enabled?'Pública':'Ainda não publicada'}</strong>
   <p className="mt-1 text-slate-300">Somente quem tiver acesso à sua identidade autenticada poderá gerenciar esta unidade.</p>
  </div>
  {recoveryCode&&<div className="space-y-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
    <strong>Guarde seu código de recuperação</strong>
    <p>Ele é exibido uma única vez e permite recuperar o gerenciamento caso você perca o acesso ao e-mail. Não grave na etiqueta nem compartilhe.</p>
    <code className="block break-all select-all rounded-lg bg-[#121A17] p-2 font-mono text-sm">{recoveryCode}</code>
    <button type="button" className="rounded-lg border border-amber-400/50 p-2" onClick={()=>void navigator.clipboard.writeText(recoveryCode).then(()=>setNotice('Código copiado. Guarde em local privado.')).catch(()=>setNotice('Selecione o código e copie manualmente.'))}>Copiar código</button>
    <button type="button" className="ml-2 underline" onClick={()=>setRecoveryCode('')}>Já guardei</button>
   </div>}
  <section className="space-y-3 rounded-xl border border-[#34443B] bg-[#1D2924] p-3 text-sm">
   <strong className="text-white">Imagem de capa e foto de apresentação</strong>
   <p className="text-slate-300">Fotos opcionais. O dispositivo transforma a imagem em WebP e remove metadados antes de enviar. O cartão público só apresenta fotos enquanto a tag estiver ativa.</p>
   {(['cover','avatar'] as const).map(slot=><div key={slot} className="space-y-2">
    <label className="block font-semibold">{slot==='cover'?'Foto de capa':'Foto de perfil'}
     <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-sm" disabled={busy||uploading||tag.blocked}
      onChange={event=>{const file=event.currentTarget.files?.[0];if(file)void upload(slot,file);event.currentTarget.value='';}}/>
    </label>
    {(slot==='cover'?coverPreview:avatarPreview)&&<img alt={slot==='cover'?'Prévia de capa':'Prévia de perfil'}
      src={slot==='cover'?coverPreview:avatarPreview} className={slot==='cover'?'h-28 w-full rounded-xl object-cover':'h-24 w-24 rounded-full object-cover'} />}
    {(slot==='cover'?presentation.coverPath:presentation.avatarPath)&&
     <button className="text-sm text-orange-300 underline" disabled={busy||uploading} type="button" onClick={()=>removeImage(slot)}>Remover foto</button>}
   </div>)}
  </section>
  <label className="block text-sm">Nome de apresentação
   <input className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={presentation.name} maxLength={80} disabled={busy} placeholder="Como deseja ser chamado?" onChange={e=>set('name',e.target.value)}/>
  </label>
  <label className="block text-sm">O que você faz?
   <input className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={presentation.occupation} maxLength={90} disabled={busy} placeholder="Ex.: Entregador, comerciante, autônomo" onChange={e=>set('occupation',e.target.value)}/>
  </label>
  <label className="block text-sm">Sobre você
   <textarea className="mt-1 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" rows={3} value={presentation.about} maxLength={320} disabled={busy} placeholder="Uma breve apresentação" onChange={e=>set('about',e.target.value)}/>
  </label>
  <section className="space-y-3 rounded-xl border border-[#34443B] p-3">
   <strong>Destinos no Kyrub (opcionais)</strong>
   <p className="text-sm text-slate-300">Adicione somente destinos públicos. Um perfil pessoal deve pertencer à sua própria conta; lojas e comunidades são indicações públicas.</p>
   {(['profile','store','community'] as const).map(kind=><label key={kind} className="block text-sm">{kind==='profile'?'Meu perfil':kind==='store'?'Loja':'Comunidade'}<input className="mt-1 min-h-11 w-full rounded-lg bg-[#1D2924] p-3" value={destinations[kind]??''} maxLength={120} disabled={busy||uploading||tag.blocked} onChange={e=>setDestinations(prev=>({...prev,[kind]:e.target.value}))}/></label>)}
  </section>
  <section className="space-y-3 rounded-xl border border-[#34443B] p-3">
   <strong>Contatos de emergência (opcionais)</strong>
   <p className="text-sm text-slate-300">O botão SOS sempre oferece 190, 192 e 193 no Brasil. Você pode cadastrar até dois contatos particulares, inclusive com opção de WhatsApp. Eles ficam ocultos até você autorizar a divulgação e declarar que a pessoa concordou.</p>
   {contacts.map((contact,i)=><div key={i} className="space-y-2 rounded-lg bg-[#1D2924] p-3">
    <div className="flex justify-between"><strong>Contato {i+1}</strong>
     <button type="button" className="text-orange-300 underline" disabled={busy||uploading}
      onClick={()=>setPresentation(current=>({...current,emergencyContacts:(current.emergencyContacts??[]).filter((_,n)=>n!==i)}))}>Remover</button>
    </div>
    <label className="block text-sm">Nome<input className="mt-1 w-full rounded-lg bg-[#121A17] p-3" value={contact.name}
     maxLength={70} disabled={busy||uploading} onChange={e=>updateContact(i,{name:e.target.value})}/></label>
    <label className="block text-sm">Relação com você<input className="mt-1 w-full rounded-lg bg-[#121A17] p-3" value={contact.relationship}
     maxLength={50} disabled={busy||uploading} placeholder="Ex.: familiar, amigo" onChange={e=>updateContact(i,{relationship:e.target.value})}/></label>
    <label className="block text-sm">Telefone brasileiro com DDD<input type="tel" className="mt-1 w-full rounded-lg bg-[#121A17] p-3"
     value={contact.phone} maxLength={25} disabled={busy||uploading} placeholder="(11) 99999-9999"
     onChange={e=>updateContact(i,{phone:e.target.value})}/></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={contact.whatsapp} disabled={busy||uploading}
     onChange={e=>updateContact(i,{whatsapp:e.target.checked})}/>Permitir contato por WhatsApp</label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={contact.shareInSos} disabled={busy||uploading}
     onChange={e=>updateContact(i,{shareInSos:e.target.checked})}/>Mostrar este contato no SOS público</label>
    {contact.shareInSos&&<label className="flex gap-2 text-sm text-amber-100"><input type="checkbox"
     checked={contact.consentConfirmed} disabled={busy||uploading}
     onChange={e=>updateContact(i,{consentConfirmed:e.target.checked})}/>
     Declaro que informei esta pessoa e obtive sua concordância para divulgar telefone e nome a qualquer visitante que escanear o adesivo.</label>}
    {!contact.shareInSos&&<p className="text-xs text-slate-400">Contato privado: não será enviado aos visitantes.</p>}
   </div>)}
   {contacts.length<2&&<button type="button" disabled={busy||uploading} className="min-h-11 rounded-xl border border-[#34443B] px-3"
    onClick={()=>setPresentation(current=>({...current,emergencyContacts:[...(current.emergencyContacts??[]),emptyContact()]}))}>+ Adicionar contato de emergência</button>}
  </section>
  <button type="button" className="min-h-12 w-full rounded-xl bg-[#F47825] px-3 font-bold text-[#121A17] disabled:opacity-50" disabled={busy||uploading||tag.blocked} onClick={()=>{const urls:string[]=[];for(const kind of ['profile','store','community'] as const){const value=(destinations[kind]??'').trim().replace(/^@/,'').toLowerCase();if(!value)continue;const url=buildPublicDestinationUrl(kind,value);if(!url){setNotice('Confira os identificadores dos destinos.');return;}urls.push(url);}void execute('configure-promotional',{presentation:{...presentation,destinations:urls}});}}>Salvar e publicar minha apresentação</button>
  <button type="button" className="min-h-11 w-full rounded-xl border border-[#34443B] p-3 text-sm disabled:opacity-50" disabled={busy} onClick={()=>void rotateRecovery()}>Gerar novo código de recuperação</button>
  {tag.blocked?
   <button type="button" className="min-h-11 w-full rounded-xl border border-amber-600/60 p-3 disabled:opacity-50" disabled={busy} onClick={()=>void execute('unblock-promotional')}>Desbloquear minha Tag</button>:
   <button type="button" className="min-h-11 w-full rounded-xl border border-rose-500/60 p-3 text-rose-200 disabled:opacity-50" disabled={busy} onClick={()=>{if(window.confirm('Bloquear esta unidade por perda? O cartão deixará de ser público, e o vínculo permanecerá.'))void execute('block-promotional');}}>Perdi minha Tag · Bloquear</button>}
  {notice&&<p role="status" className="text-sm text-slate-200">{notice}</p>}
 </section>;
}
