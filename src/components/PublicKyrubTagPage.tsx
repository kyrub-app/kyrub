import {useEffect,useRef,useState} from 'react';
import {isSignInWithEmailLink,onAuthStateChanged,signOut,type User} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {OfficialKyrubTagPanel} from './OfficialKyrubTagPanel';
import {PromotionalKyrubTagEditor} from './PromotionalKyrubTagEditor';
import {PresentationCard} from './PresentationCard';
import {TagEmailLinkIdentity} from './TagEmailLinkIdentity';
import {EMPTY_PROMOTIONAL_PRESENTATION,type PromotionalTagPresentation,type PublicPromotionalTagPresentation} from '../../shared/kyrubTagPromotional';
import {publicPromotionalTagImageUrl} from '../utils/kyrubTagMedia';
import {KYRUB_TAG_MODEL_LABELS,isTagModel,parseTagExternalUrl,type KyrubTagModel,type OwnedKyrubTag} from '../../shared/kyrubTagContract';
import {parsePublicDestinationUrl,buildPublicDestinationPath} from '../../shared/publicDestinationRoutes';

type Payload={
 id:string;model:KyrubTagModel;status:'unclaimed'|'active';
 activation?:'account'|'code'|'email'|'setup';
 links:{name:string;url:string}[];
 presentation?:PublicPromotionalTagPresentation;
};
type OwnershipResponse={tag:OwnedKyrubTag;recoveryCode:string|null};

function initialDraft(id:string):PromotionalTagPresentation{
 try{
  const raw=sessionStorage.getItem('kyrub.tag.draft.'+id);
  if(!raw)return {...EMPTY_PROMOTIONAL_PRESENTATION};
  const value=JSON.parse(raw) as PromotionalTagPresentation;
  if(typeof value.name==='string'&&typeof value.occupation==='string'&&typeof value.about==='string')
   return {name:value.name.slice(0,80),occupation:value.occupation.slice(0,90),about:value.about.slice(0,320)};
 }catch{ /* Private browsing or a new device: start with an empty draft. */ }
 return {...EMPTY_PROMOTIONAL_PRESENTATION};
}
const intentKey=(id:string)=>'kyrub.tag.publish-intent.'+id;
type PublishIntent={email:string;draft:PromotionalTagPresentation;expires:number};
function readIntent(id:string):PublishIntent|null{
 try{
  const key=intentKey(id),raw=localStorage.getItem(key);
  if(!raw)return null;
  const v=JSON.parse(raw) as PublishIntent;
  if(typeof v.email!=='string'||typeof v.expires!=='number'||v.expires<=Date.now()||
    typeof v.draft?.name!=='string'||typeof v.draft?.occupation!=='string'||typeof v.draft?.about!=='string'){
   localStorage.removeItem(key);return null;
  }
  return {email:v.email,expires:v.expires,draft:{name:v.draft.name.slice(0,80),occupation:v.draft.occupation.slice(0,90),about:v.draft.about.slice(0,320)}};
 }catch{return null;}
}
function clearIntent(id:string){try{localStorage.removeItem(intentKey(id));}catch{}}
const emergencyServices=[{name:'Polícia Militar',number:'190'},{name:'SAMU',number:'192'},{name:'Bombeiros',number:'193'}] as const;

export function PublicKyrubTagPage({identifier}:{identifier:string}){
 const [data,setData]=useState<Payload|null>(null);
 const [error,setError]=useState('');
 const [user,setUser]=useState<User|null>(null);
 const [authReady,setAuthReady]=useState(false);
 const [owner,setOwner]=useState(false);
 const [ownerRecord,setOwnerRecord]=useState<OwnedKyrubTag|null>(null);
 const [recoveryCode,setRecoveryCode]=useState('');
 const [checked,setChecked]=useState(false);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [showSos,setShowSos]=useState(false);
 const [showEdit,setShowEdit]=useState(false);
 const [showRecovery,setShowRecovery]=useState(false);
 const [recoveryInput,setRecoveryInput]=useState('');
 const [draft,setDraft]=useState<PromotionalTagPresentation>(()=>initialDraft(identifier));
 const lock=useRef(false);
 const [emailStep,setEmailStep]=useState(()=>isSignInWithEmailLink(auth,window.location.href));
 const [returning,setReturning]=useState(()=>isSignInWithEmailLink(auth,window.location.href));
 const [verifiedReturn,setVerifiedReturn]=useState<User|null>(null);
 const [autoAttempted,setAutoAttempted]=useState(false);
 const manage='/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(identifier);
 const loginPath='/?tagActivation='+encodeURIComponent(identifier);

 useEffect(()=>onAuthStateChanged(auth,u=>{
  setOwner(false);setOwnerRecord(null);setChecked(false);setNotice('');
  setUser(u);setAuthReady(true);
 }),[]);
 useEffect(()=>{
  const ctrl=new AbortController();setOwner(false);setOwnerRecord(null);
  if(user)void user.getIdToken().then(token=>fetch(manage,{
   headers:{Authorization:'Bearer '+token},cache:'no-store',signal:ctrl.signal
  })).then(async r=>{
   if(ctrl.signal.aborted||!r.ok)return;
   const found=await r.json() as OwnedKyrubTag;
   if(found.id===identifier&&!ctrl.signal.aborted){setOwnerRecord(found);setOwner(true);}
  }).catch(()=>{});
  return()=>ctrl.abort();
 },[user,identifier]);
 useEffect(()=>{
  const ctrl=new AbortController();setData(null);setError('');
  void fetch('/api/health?transport=public-kyrub-tag&id='+encodeURIComponent(identifier),{
   cache:'no-store',signal:ctrl.signal
  }).then(async res=>{
   if(!res.ok)throw Error(res.status===404?'Dispositivo indisponível.':'Não foi possível consultar o dispositivo.');
   const value=await res.json() as Payload;
   if(value.id!==identifier||!isTagModel(value.model)||!Array.isArray(value.links)||!['unclaimed','active'].includes(value.status))
    throw Error('Dispositivo indisponível.');
   if(!ctrl.signal.aborted)setData(value);
  }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Dispositivo indisponível.');});
  return()=>ctrl.abort();
 },[identifier]);
 function setPresentation(key:keyof PromotionalTagPresentation,value:string){
  setDraft(current=>{
   const next={...current,[key]:value};
   try{sessionStorage.setItem('kyrub.tag.draft.'+identifier,JSON.stringify(next));}catch{}
   return next;
  });
 }
 async function request(action:string,extra:Record<string,unknown>={}):Promise<unknown>{
  const active=auth.currentUser;
  if(!active)throw Error('AUTH_REQUIRED');
  const token=await active.getIdToken(true);
  const res=await fetch(manage,{method:'POST',cache:'no-store',headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/json'
  },body:JSON.stringify({action,...extra})});
  if(auth.currentUser?.uid!==active.uid||!res.ok)throw Error('TAG_FORBIDDEN');
  return res.json();
 }
 async function claimReserved(){
  if(!user||!checked||lock.current||data?.activation!=='account'||auth.currentUser?.uid!==user.uid)return;
  lock.current=true;setBusy(true);setNotice('');
  try{
   await request('claim-reserved');
   setOwner(true);setNotice('Vínculo definitivo concluído. Personalize sua Kyrub Tag!');
  }catch{setNotice('Não foi possível vincular. Entre com a conta reservada e confira seu cadastro Kyrub.');}
  finally{lock.current=false;setBusy(false);setChecked(false);}
 }
 async function claimPromotional(presentation:PromotionalTagPresentation=draft){
  if(!user?.emailVerified||auth.currentUser?.uid!==user.uid||data?.activation!=='email'||lock.current)return;
  lock.current=true;setBusy(true);setNotice('');
  try{
   const result=await request('claim-and-publish-promotional',{presentation}) as OwnershipResponse;
   if(result.tag.id!==identifier||result.tag.distribution!=='promotional')throw Error('TAG_INVALID');
   setRecoveryCode(result.recoveryCode??'');
   clearIntent(identifier);
   try{sessionStorage.removeItem('kyrub.tag.draft.'+identifier);}catch{}
   setOwnerRecord(result.tag);setOwner(true);
  }catch{setNotice('Não foi possível ativar. Esta unidade pode ter sido ativada por outra pessoa ou a campanha ainda não foi liberada.');}
  finally{lock.current=false;setBusy(false);}
 }
 function rememberPublication(email:string){
  const intent:PublishIntent={email:email.trim().toLowerCase(),draft:{name:draft.name,occupation:draft.occupation,about:draft.about},expires:Date.now()+60*60*1000};
  localStorage.setItem(intentKey(identifier),JSON.stringify(intent));
 }
 function verifiedPublication(identity:User){
  setReturning(false);
  const intent=readIntent(identifier);
  if(intent&&identity.emailVerified&&identity.email?.trim().toLowerCase()===intent.email){
   setDraft(intent.draft);setVerifiedReturn(identity);
  }else{
   setEmailStep(false);
   setNotice('E-mail confirmado. Revise sua apresentação e publique para concluir a ativação.');
  }
 }
 useEffect(()=>{
  if(!verifiedReturn||!user||user.uid!==verifiedReturn.uid||!user.emailVerified||data?.activation!=='email'||autoAttempted||owner)return;
  const intent=readIntent(identifier);
  if(!intent||user.email?.trim().toLowerCase()!==intent.email)return;
  setAutoAttempted(true);
  void claimPromotional(intent.draft);
 // Only a successful email-link callback may trigger automatic publication.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[verifiedReturn,user,data,autoAttempted,owner,identifier]);
 async function recover(){
  if(!user?.emailVerified||lock.current||!/^[a-f0-9]{48}$/.test(recoveryInput.trim()))return;
  lock.current=true;setBusy(true);setNotice('');
  try{
   const result=await request('recover-promotional',{recoveryCode:recoveryInput.trim()}) as OwnershipResponse;
   if(result.tag.id!==identifier||result.tag.distribution!=='promotional')throw Error('TAG_INVALID');
   setOwnerRecord(result.tag);setRecoveryCode(result.recoveryCode??'');setOwner(true);setRecoveryInput('');
  }catch{setNotice('Recuperação não autorizada. Verifique o código e a identidade de e-mail utilizada.');}
  finally{lock.current=false;setBusy(false);}
 }

 if(authReady&&owner&&user)return <main className="min-h-screen bg-[#121A17] p-4 text-[#F5F5F3]"><div className="mx-auto max-w-md space-y-3 py-5">
  {ownerRecord?.distribution==='promotional'?
   <PromotionalKyrubTagEditor initial={ownerRecord} oneTimeRecoveryCode={recoveryCode}/>:
   <OfficialKyrubTagPanel key={user.uid+identifier} userId={user.uid} initialTagId={identifier}/>}
  <a href={ownerRecord?.distribution==='promotional'?'/?entry=welcome':'/'} className="block p-3 text-center text-sm text-slate-300 underline">Conhecer o Kyrub</a>
 </div></main>;

 const promotional=data?.status==='unclaimed'&&(data.activation==='email'||data.activation==='setup');
 return <main className="min-h-screen bg-[#121A17] p-4 text-[#F5F5F3]"><div className="mx-auto max-w-md space-y-4 py-6">
  <header className="flex items-center justify-between gap-2">
   <a href="/" className="font-black text-[#F47825]">KYRUB TAG</a>
   {!promotional&&<a href="/?entry=welcome" className="text-sm text-slate-300 underline">Conhecer o Kyrub</a>}
  </header>
  {!authReady?<p role="status">Restaurando sessão…</p>:data?.status==='active'&&data.presentation?
   <PresentationCard headingLevel="h1" name={data.presentation.name||'Minha Kyrub Tag'} occupation={data.presentation.occupation} bio={data.presentation.about}
    photoUrl={data.presentation.hasAvatar?publicPromotionalTagImageUrl(identifier,'avatar'):undefined}
    coverUrl={data.presentation.hasCover?publicPromotionalTagImageUrl(identifier,'cover'):undefined}
    backgroundUrl={data.presentation.hasBackground?publicPromotionalTagImageUrl(identifier,'background'):undefined}
    links={data.links}>
    <button type="button" className="min-h-12 w-full rounded-xl bg-red-800 p-3 font-bold text-white" aria-expanded={showSos} onClick={()=>setShowSos(s=>!s)}>SOS · Informações de emergência</button>
    {showSos&&<div className="space-y-2 rounded-xl border border-rose-600/50 p-3">
     <h2 className="font-semibold">Emergência no Brasil</h2>
     <p className="text-xs text-slate-300">Toque em um número para abrir o discador. Esta página não envia alertas nem aciona socorro automaticamente.</p>
     {emergencyServices.map(service=><a key={service.number} className="flex min-h-11 items-center justify-between rounded-lg border border-[#34443B] p-3" href={'tel:'+service.number}><span>{service.name}</span><strong>{service.number}</strong></a>)}
     {data.presentation.sosContacts.length>0&&<div className="space-y-3 border-t border-rose-400/40 pt-3">
      <h3 className="font-semibold">Pessoas de confiança</h3>
      <p className="text-xs text-slate-300">Contatos disponibilizados voluntariamente pelo titular. Não há serviço de atendimento ou monitoramento de emergência.</p>
      {data.presentation.sosContacts.map(contact=><div key={contact.phone} className="space-y-2 rounded-lg border border-[#34443B] p-3">
       <p className="font-semibold">{contact.name}{contact.relationship?' · '+contact.relationship:''}</p>
       <a className="inline-flex min-h-10 items-center rounded-lg bg-[#24332C] px-3 underline" href={'tel:'+contact.phone}>Ligar para {contact.phone}</a>
       {contact.whatsapp&&<a className="ml-2 inline-flex min-h-10 items-center rounded-lg bg-[#24332C] px-3 underline"
         href={'https://wa.me/'+contact.phone.replace(/\D/g,'')} target="_blank" rel="noopener noreferrer">WhatsApp do contato</a>}
      </div>)}
     </div>}
    </div>}
    <button type="button" className="flex items-center gap-2 text-sm text-[#F47825]" onClick={()=>setShowEdit(v=>!v)}>✎ Editar minha Tag</button>
   </PresentationCard>:
   promotional?
   <section className="space-y-4 rounded-2xl border border-[#34443B] p-4">
    <h1 className="text-2xl font-bold">Sua apresentação, do seu jeito.</h1>
    <p className="text-sm text-slate-300">Este adesivo pode ser ativado por quem concluir primeiro a confirmação do e-mail. Você não precisa de uma conta Kyrub completa.</p>
    <label className="block text-sm">Nome de apresentação (opcional)
     <input className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={draft.name} maxLength={80} placeholder="Como deseja ser chamado?" onChange={e=>setPresentation('name',e.target.value)}/>
    </label>
    <label className="block text-sm">O que você faz? (opcional)
     <input className="mt-1 min-h-11 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={draft.occupation} maxLength={90} placeholder="Entregador, autônomo, comerciante" onChange={e=>setPresentation('occupation',e.target.value)}/>
    </label>
    <label className="block text-sm">Sobre você (opcional)
     <textarea className="mt-1 w-full rounded-xl border border-[#34443B] bg-[#1D2924] p-3" value={draft.about} rows={3} maxLength={320} placeholder="Sua breve apresentação" onChange={e=>setPresentation('about',e.target.value)}/>
    </label>
    <p className="text-sm text-slate-300">A apresentação pública incluirá um botão SOS com números oficiais. Não são publicados e-mail ou dados médicos.</p>
    {data.activation==='setup'?<p role="status" className="rounded-xl border border-amber-500/50 p-3 text-sm">A ativação promocional ainda não foi liberada para esta campanha.</p>:returning||(!user?.emailVerified&&emailStep)?
      <TagEmailLinkIdentity tagId={identifier} onBeforeSend={rememberPublication} onVerified={verifiedPublication} resumeEmail={returning?readIntent(identifier)?.email:undefined}/>:
      <div className="space-y-3">
       <p className="text-sm text-slate-300">Ao publicar, você solicita a titularidade e autoriza a divulgação da apresentação. Fotos e contatos opcionais podem ser adicionados depois.</p>
       {user?.emailVerified&&<p className="text-sm text-slate-300">Identidade verificada: {user.email}</p>}
       <button type="button" className="min-h-12 w-full rounded-xl bg-[#F47825] px-4 font-bold text-[#121A17] disabled:opacity-50" disabled={busy||(!!verifiedReturn&&!autoAttempted)} onClick={()=>user?.emailVerified?void claimPromotional():setEmailStep(true)}>{busy?'Ativando…':'Publicar minha Kyrub Tag'}</button>
      </div>}
   </section>:
   data?.status==='unclaimed'&&data.activation==='account'?
   <section className="space-y-3 rounded-xl border border-[#34443B] p-4"><h1 className="text-xl font-bold">Vincule sua Kyrub Tag</h1>
    <p>Esta unidade experimental foi reservada para uma conta específica. Não é necessário informar códigos.</p>
    {user?<><p className="break-all text-sm">Conta atual: {user.email??'Conta sem e-mail'}</p>
     <label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>Confirmo que desejo vincular esta unidade definitivamente. A titularidade não poderá ser transferida.</label>
     <button type="button" disabled={!checked||busy} onClick={()=>void claimReserved()} className="min-h-11 w-full rounded-xl bg-[#F47825] p-3 font-bold text-[#121A17] disabled:opacity-50">Vincular minha Kyrub Tag</button>
     <button type="button" className="block underline" onClick={()=>void signOut(auth).then(()=>window.location.assign(loginPath))}>Usar outra conta</button>
    </>:<a href={loginPath} className="block rounded-xl bg-[#F47825] p-3 text-center font-bold text-[#121A17]">Entrar e vincular</a>}
   </section>:
   data?.status==='unclaimed'?
   <p className="rounded-xl border border-[#34443B] p-4">{data.activation==='code'?'Esta unidade exige o código de ativação de seu produto oficial.':'Aguardando ativação da unidade.'}</p>:
   error?<p role="status" className="rounded-xl border border-[#34443B] p-4">{error}</p>:
   !data?<p role="status">Consultando dispositivo…</p>:
   <section className="space-y-3">{data.links.length===0?<p>Nenhum destino público disponível.</p>:
    data.links.map(l=>{const ext=parseTagExternalUrl(l.url);if(ext)return <a key={l.url} href={ext.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-[#34443B] p-4">{ext.name}</a>;
     const p=parsePublicDestinationUrl(l.url);if(!p||p.kind==='card')return null;
     return <a key={l.url} className="block rounded-xl border border-[#34443B] p-4" href={buildPublicDestinationPath(p.kind,p.identifier)??'/'}>{l.name}</a>;
    })}
   </section>}
  {(showEdit||showRecovery)&&!owner&&<section className="space-y-3 rounded-xl border border-[#34443B] p-3">
   <h2 className="font-semibold">Acesso protegido do titular</h2>
   <p className="text-sm text-slate-300">Saber o endereço NFC não autoriza editar. Confirme sua identidade pelo e-mail usado na ativação.</p>
   {!user?.emailVerified?<TagEmailLinkIdentity tagId={identifier}/>:<p className="text-sm text-slate-300">Autenticado como {user.email}. Se esta é sua unidade, o painel de edição será aberto.</p>}
  </section>}
  <button type="button" className="text-sm text-slate-300 underline" onClick={()=>setShowRecovery(v=>!v)}>Perdi meu e-mail · Recuperar com código</button>
  {showRecovery&&<section className="space-y-3 rounded-xl border border-[#34443B] p-3">
   <p className="text-sm text-slate-300">Use o código secreto de recuperação entregue na primeira ativação. Será necessário verificar o novo e-mail; a tag ficará bloqueada até você revisá-la.</p>
   {user?.emailVerified?<><p className="text-sm text-slate-300">Novo e-mail verificado: {user.email}</p>
    <input type="password" autoComplete="off" spellCheck={false} className="min-h-11 w-full rounded-lg border border-[#34443B] bg-[#1D2924] p-3 font-mono" value={recoveryInput} onChange={e=>setRecoveryInput(e.target.value.trim().toLowerCase())} placeholder="Código de recuperação (48 caracteres)" maxLength={48}/>
    <button type="button" className="min-h-11 rounded-lg bg-[#F47825] px-4 font-semibold text-[#121A17] disabled:opacity-50" disabled={busy||!/^[a-f0-9]{48}$/.test(recoveryInput)} onClick={()=>void recover()}>Recuperar gerenciamento</button>
    <button type="button" className="block text-sm underline text-slate-300" disabled={busy} onClick={()=>void signOut(auth)}>Verificar outro e-mail</button></>:<TagEmailLinkIdentity tagId={identifier}/>}
  </section>}
  {notice&&<p role="status" className="text-sm text-slate-200">{notice}</p>}
  {!promotional&&<a href="/?entry=welcome" className="block rounded-xl border border-[#34443B] p-3 text-center">Conhecer o Kyrub</a>}
 </div></main>;
}
