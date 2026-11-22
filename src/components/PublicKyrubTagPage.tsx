import {useEffect,useRef,useState} from 'react';
import {onAuthStateChanged,signOut,type User} from 'firebase/auth';
import {auth} from '../utils/firebase';
import {OfficialKyrubTagPanel} from './OfficialKyrubTagPanel';
import {KYRUB_TAG_MODEL_LABELS,isTagModel,parseTagExternalUrl,type KyrubTagModel} from '../../shared/kyrubTagContract';
import {parsePublicDestinationUrl,buildPublicDestinationPath} from '../../shared/publicDestinationRoutes';
type Payload={id:string;model:KyrubTagModel;status:'unclaimed'|'active';activation?:'account'|'code';links:{name:string;url:string}[]};
export function PublicKyrubTagPage({identifier}:{identifier:string}){
 const [data,setData]=useState<Payload|null>(null),[error,setError]=useState(''),[user,setUser]=useState<User|null>(null),[authReady,setAuthReady]=useState(false),[owner,setOwner]=useState(false),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const lock=useRef(false);
 const manage='/api/health?transport=manage-kyrub-tag&id='+encodeURIComponent(identifier);
 useEffect(()=>onAuthStateChanged(auth,u=>{setOwner(false);setChecked(false);setNotice('');setUser(u);setAuthReady(true);}),[]);
 useEffect(()=>{const ctrl=new AbortController();setOwner(false);
 if(user)void user.getIdToken().then(token=>fetch(manage,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:ctrl.signal})).then(r=>{if(!ctrl.signal.aborted&&r.ok)setOwner(true);}).catch(()=>{});
 return()=>ctrl.abort();},[user,identifier]);
 useEffect(()=>{const ctrl=new AbortController();setData(null);setError('');
 void fetch('/api/health?transport=public-kyrub-tag&id='+encodeURIComponent(identifier),{cache:'no-store',signal:ctrl.signal}).then(async res=>{
 if(!res.ok)throw Error(res.status===404?'Dispositivo indisponível.':'Não foi possível consultar o dispositivo.');
 const value=await res.json() as Payload;
 if(value.id!==identifier||!isTagModel(value.model)||!Array.isArray(value.links)||!['unclaimed','active'].includes(value.status))throw Error('Dispositivo indisponível.');
 if(!ctrl.signal.aborted)setData(value);
 }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Dispositivo indisponível.');});return()=>ctrl.abort();},[identifier]);
 const loginPath='/?tagActivation='+encodeURIComponent(identifier);
 async function claim(){
  if(!user||!checked||lock.current||data?.activation!=='account'||auth.currentUser?.uid!==user.uid)return;
  lock.current=true;setBusy(true);setNotice('');
  try{
   const token=await user.getIdToken(true);
   const res=await fetch(manage,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'claim-reserved'}),cache:'no-store'});
   if(auth.currentUser?.uid!==user.uid)return;
   if(!res.ok)throw Error('TAG_FORBIDDEN');
   setOwner(true);setNotice('Vínculo definitivo concluído. Personalize sua Kyrub Tag!');
  }catch{setNotice('Não foi possível vincular. Entre com a conta reservada pelo responsável e confira se seu cadastro Kyrub está concluído.');}
  finally{lock.current=false;setBusy(false);setChecked(false);}
 }
 return <main className="min-h-screen bg-slate-950 p-4 text-slate-100"><div className="mx-auto max-w-md space-y-4 py-8">
 <a href="/" className="font-black text-orange-300">KYRUB</a><h1 className="text-2xl font-black">Kyrub Tag</h1>
 {!authReady?<p role="status">Restaurando sessão…</p>:owner&&user?<><p>Minha Kyrub Tag</p><OfficialKyrubTagPanel key={user.uid+identifier} userId={user.uid} initialTagId={identifier}/></>:error?<p role="status">{error}</p>:!data?<p role="status">Consultando dispositivo…</p>:<>
 <p>{KYRUB_TAG_MODEL_LABELS[data.model]}</p>
 {data.status==='unclaimed'?(data.activation==='account'?<div className="space-y-3 rounded-xl bg-slate-900 p-4"><strong>Vincule sua Kyrub Tag</strong><p>Entre com a conta indicada pelo responsável pela entrega. Não é necessário informar códigos.</p>
 {user?<><p className="break-all">Conta atual: {user.email??'Conta sem e-mail'}</p><label className="flex gap-2"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>Confirmo que desejo vincular esta unidade à minha conta definitivamente. A titularidade não poderá ser transferida.</label><button className="w-full rounded-xl bg-orange-500 p-3 font-bold text-slate-950 disabled:opacity-50" type="button" disabled={!checked||busy} onClick={()=>void claim()}>Vincular minha Kyrub Tag</button><button className="underline" disabled={busy} onClick={()=>void signOut(auth).then(()=>{window.location.assign(loginPath);}).catch(()=>setNotice('Não foi possível trocar de conta.'))}>Usar outra conta</button><a className="block underline" href={loginPath}>Concluir cadastro no Kyrub</a></>:<a href={loginPath} className="block rounded-xl bg-orange-500 p-3 text-center font-bold text-slate-950">Entrar e vincular</a>}</div>:<div className="space-y-3 rounded-xl bg-slate-900 p-4"><strong>Aguardando reserva</strong><p>Peça ao responsável pela entrega para reservar esta unidade para sua conta. Nenhum identificador precisa ser digitado.</p></div>):data.links.length===0?<p>Nenhum destino público disponível.</p>:data.links.map(l=>{const external=parseTagExternalUrl(l?.url);if(external)return <a key={external.url} href={external.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl border border-slate-700 bg-slate-900 p-4">{external.name} · link externo</a>;const p=typeof l?.url==='string'?parsePublicDestinationUrl(l.url):null;if(!p||p.kind==='card'||typeof l.name!=='string')return null;return <a key={l.url} href={buildPublicDestinationPath(p.kind,p.identifier)??'/'} className="block rounded-xl border border-slate-700 bg-slate-900 p-4">{l.name}</a>;})}
 <p className="text-xs text-slate-400">Registro no Kyrub não comprova autenticidade criptográfica do chip físico.</p></>}
 <p role="status">{notice}</p><a href="/" className="block rounded-xl border border-slate-700 p-3 text-center">Acessar Kyrub</a>
 </div></main>;
}
