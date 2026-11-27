import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {onAuthStateChanged,type User} from 'firebase/auth';
import {auth} from '../../utils/firebase';
import {normalizePersonalPixKey,type PersonalPixKeyType} from '../../../shared/personalPixDestination';

export function personalFinanceCandidateEnabled(){
 return import.meta.env.DEV&&import.meta.env.VITE_KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION==='true'&&
 import.meta.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'&&auth.app.options.projectId==='kyrub-security-test'&&
 typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname);
}
type Snapshot={revision:number;status:'not_configured'|'declared'|'revoked';ownershipVerified:false;keyType?:PersonalPixKeyType;maskedKey?:string};
type CidCandidate={cidId:string;sourceVersion:string;keyType:PersonalPixKeyType;maskedKey:string;ownershipVerified:false};
function validCandidates(value:unknown):value is {candidates:CidCandidate[]}{
 if(!value||typeof value!=='object'||Object.keys(value).length!==1)return false;
 const v=value as {candidates:unknown[]};
 if(!Array.isArray(v.candidates)||v.candidates.length>20)return false;
 const ids=new Set<string>();
 return v.candidates.every(raw=>{
  if(!raw||typeof raw!=='object')return false;
  const c=raw as CidCandidate;
  if(!/^[a-f0-9]{32}$/.test(c.cidId)||!/^\d{1,12}:\d{1,9}$/.test(c.sourceVersion)||
   !Object.prototype.hasOwnProperty.call(types,c.keyType)||typeof c.maskedKey!=='string'||!/^••••.{4}$/.test(c.maskedKey)||
   c.ownershipVerified!==false||Object.keys(c).length!==5||!Object.keys(c).every(k=>['cidId','sourceVersion','keyType','maskedKey','ownershipVerified'].includes(k))||ids.has(c.cidId))return false;
  ids.add(c.cidId);return true;
 });
}
const types:Record<PersonalPixKeyType,string>={cpf:'CPF',email:'E-mail',phone:'Celular',random:'Chave aleatória'};
const labels:Record<string,string>={PERSONAL_PIX_INVALID:'Confira o formato da chave e a confirmação.',PERSONAL_PIX_CONFLICT:'O cadastro mudou. Atualize antes de tentar novamente.',AUTH_REQUIRED:'Entre novamente para continuar.',REAUTHENTICATION_REQUIRED:'Entre novamente na sua conta antes de alterar a chave. Atualizar a página não renova a autenticação.',EMAIL_VERIFICATION_REQUIRED:'Confirme seu e-mail para continuar.',IDENTITY_VERIFICATION_REQUIRED:'A declaração exige perfil profissional aprovado.',PERSONAL_CID_UNAVAILABLE:'O CID não está disponível para importação.',PERSONAL_CID_CHANGED:'O CID foi alterado. Atualize o cadastro e confirme novamente.',PERSONAL_CID_LIST_LIMIT:'Há muitos CIDs vinculados para esta consulta.'};
function valid(v:unknown):v is Snapshot{
 if(!v||typeof v!=='object')return false;
 const d=v as Snapshot;
 return Number.isSafeInteger(d.revision)&&d.revision>=0&&d.ownershipVerified===false&&
 ((d.status==='not_configured'&&d.revision===0&&d.keyType===undefined&&d.maskedKey===undefined)||
 (d.status==='revoked'&&d.revision>0&&d.keyType===undefined&&d.maskedKey===undefined)||
 (d.status==='declared'&&d.revision>0&&Object.prototype.hasOwnProperty.call(types,d.keyType??'')&&typeof d.maskedKey==='string'&&/^••••.{4}$/.test(d.maskedKey)))&&
 Object.keys(d).every(k=>['revision','status','ownershipVerified','keyType','maskedKey'].includes(k));
}
const field='w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white';
const btn='rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-cyan-300 disabled:opacity-50';
export function PersonalPixSettings({onActivity}:{onActivity?:(uid:string,active:boolean)=>void}){
 const [user,setUser]=useState<User|null>(null),[snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [type,setType]=useState<PersonalPixKeyType>('random'),[key,setKey]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [revoke,setRevoke]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [refresh,setRefresh]=useState(0);
 const [candidates,setCandidates]=useState<CidCandidate[]>([]),[cidError,setCidError]=useState('');
 const [selectedCid,setSelectedCid]=useState<string|null>(null),[cidConfirmed,setCidConfirmed]=useState(false);
 const generation=useRef(0),request=useRef<AbortController|null>(null),locked=useRef(false);
 const activityUid=auth.currentUser?.uid;
 useLayoutEffect(()=>{
  if(!activityUid||!onActivity)return;
  onActivity(activityUid,true);return()=>onActivity(activityUid,false);
 },[activityUid,onActivity]);
 const clear=()=>{setKey('');setConfirmed(false);setRevoke(false);setSelectedCid(null);setCidConfirmed(false);};
 useEffect(()=>{
  const unsubscribe=onAuthStateChanged(auth,u=>{
   generation.current++;request.current?.abort();locked.current=false;
   setUser(u);setSnapshot(null);setCandidates([]);setCidError('');clear();setType('random');setError('');setNotice('');setBusy(false);
  });
  return()=>{generation.current++;request.current?.abort();unsubscribe();};
 },[]);
 useEffect(()=>{
  if(!user||auth.currentUser?.uid!==user.uid)return;
  const n=++generation.current,abort=new AbortController();request.current=abort;locked.current=true;
  const active=()=>n===generation.current&&auth.currentUser?.uid===user.uid&&!abort.signal.aborted;
  setBusy(true);setSnapshot(null);setCandidates([]);setCidError('');clear();setError('');setNotice('');
  void(async()=>{
   const token=await user.getIdToken();if(!active())return;
   const response=await fetch('/api/personal-finance/pix',{headers:{authorization:'Bearer '+token},cache:'no-store',signal:abort.signal});
   const data=await response.json().catch(()=>null);
   if(!response.ok||!valid(data))throw Error(labels[data?.code]??'Consulta não confirmada.');
   if(active())setSnapshot(data);
   try{
    const response=await fetch('/api/personal-finance/pix?view=cid_candidates',{headers:{authorization:'Bearer '+token},cache:'no-store',signal:abort.signal});
    const list=await response.json().catch(()=>null);
    if(!response.ok||!validCandidates(list))throw Error(labels[list?.code]??'Não foi possível consultar os CIDs vinculados.');
    if(active())setCandidates(list.candidates);
   }catch(e){if(active())setCidError(e instanceof Error?e.message:'Consulta de CIDs indisponível.');}
  })().catch(e=>{if(active())setError(e instanceof Error?e.message:'Consulta não confirmada.');}).finally(()=>{if(active()){locked.current=false;setBusy(false);}});
  return()=>{generation.current++;abort.abort();};
 },[user,refresh]);
 const current=user&&auth.currentUser?.uid===user.uid?snapshot:null;
 const submit=async(action:'declare'|'revoke'|'import_cid')=>{
  if(locked.current||!current||!user||auth.currentUser?.uid!==user.uid||(action==='import_cid'?!cidConfirmed:!confirmed))return;
  const candidate=action==='import_cid'?candidates.find(c=>c.cidId===selectedCid):undefined;
  if(action==='import_cid'&&!candidate)return;
  let destination;
  try{if(action==='declare')destination=normalizePersonalPixKey({keyType:type,key});}catch{setError(labels.PERSONAL_PIX_INVALID);return;}
  locked.current=true;setBusy(true);setError('');setNotice('');
  const n=++generation.current,abort=new AbortController();request.current=abort;
  const active=()=>n===generation.current&&auth.currentUser?.uid===user.uid&&!abort.signal.aborted;
  clear();
  try{
   const token=await user.getIdToken();if(!active())return;
   const res=await fetch('/api/personal-finance/pix',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},cache:'no-store',signal:abort.signal,
    body:JSON.stringify({action,expectedRevision:current.revision,confirmed:true,...(destination?{destination}:{}),...(candidate?{cidId:candidate.cidId,sourceVersion:candidate.sourceVersion,replaceExisting:current.status==='declared'}:{})})});
   const data=await res.json().catch(()=>null);
   if(!res.ok||!valid(data)||data.revision!==current.revision+1||data.status!==(action==='revoke'?'revoked':'declared'))throw Error(labels[data?.code]??'Alteração não confirmada. Consulte novamente.');
   if(active()){setSnapshot(data);setNotice(action==='import_cid'?'Chave Pix do CID aproveitada. Titularidade não verificada.':action==='declare'?'Chave de teste declarada. Titularidade não verificada.':'Revogação confirmada pelo servidor.');}
  }catch(e){if(active()){setSnapshot(null);setCandidates([]);setError(e instanceof Error?e.message:'Alteração não confirmada. Consulte novamente.');}}
  finally{if(active()){locked.current=false;setBusy(false);}}
 };
 return <section id="personal-pix-settings" className="space-y-3 rounded-2xl border border-slate-700 p-3 text-sm text-slate-300">
  <h5 className="text-base font-bold text-white">Configurações financeiras</h5>
  <p className="text-amber-300">Homologação local · use somente chaves fictícias. Sem dinheiro real.</p>
  <h6 className="font-bold text-white">Pix externo</h6>
  <p>Recebimento em instituição de sua escolha. Não é saldo Kyrub. A declaração não comprova titularidade bancária.</p>
  <button type="button" className={btn} disabled={busy||!user} onClick={()=>setRefresh(n=>n+1)}>Atualizar cadastro</button>
  {busy&&<p role="status">Consultando servidor…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {current&&<>
   <p>{current.status==='declared'?'Chave declarada: '+types[current.keyType!]+ ' '+current.maskedKey:current.status==='revoked'?'Chave revogada':'Nenhuma chave cadastrada'}</p>
   {cidError&&<p role="status">{cidError} O cadastro manual continua disponível.</p>}
   {!revoke&&candidates.length>0&&<div className="space-y-2 rounded-xl border border-slate-700 p-3">
    <h6 className="font-bold text-white">Chaves Pix dos meus CIDs</h6>
    <p>Use uma chave já cadastrada, sem digitar novamente. Alterações futuras no CID não modificarão este cadastro financeiro.</p>
    {candidates.map((c,i)=><label key={c.cidId} className="flex items-center gap-2">
      <input type="radio" name="cid-pix-choice" checked={selectedCid===c.cidId} disabled={busy} onChange={()=>{clear();setSelectedCid(c.cidId);}}/>
      CID {i+1} · {types[c.keyType]} {c.maskedKey} · {c.cidId.slice(-6)}
    </label>)}
    {selectedCid&&<>
     <label className="flex items-start gap-2"><input type="checkbox" checked={cidConfirmed} disabled={busy} onChange={e=>setCidConfirmed(e.target.checked)}/>{current.status==='declared'?'Confirmo a substituição da chave financeira atual pela chave fictícia deste CID.':'Confirmo o uso financeiro da chave fictícia deste CID.'}</label>
     <button type="button" className={btn} disabled={busy||!cidConfirmed} onClick={()=>void submit('import_cid')}>{current.status==='declared'?'Substituir pela chave do CID':'Utilizar chave Pix do meu CID'}</button>
     <button type="button" className={btn} disabled={busy} onClick={clear}>Cancelar escolha do CID</button>
    </>}
   </div>}
   {!revoke&&!selectedCid&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();void submit('declare');}}>
    <label className="block">Tipo de chave<select className={field} value={type} disabled={busy} onChange={e=>{setType(e.target.value as PersonalPixKeyType);clear();}}>{Object.entries(types).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label className="block">Chave Pix de teste<input className={field} type="password" autoComplete="off" spellCheck={false} maxLength={254} value={key} disabled={busy} onChange={e=>{setKey(e.target.value);setConfirmed(false);}}/></label>
    {type==='phone'&&<p>Formato: +55 seguido de DDD e número.</p>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo que esta é uma chave fictícia para homologação.</label>
    <button type="submit" className={btn} disabled={busy||!key.trim()||!confirmed}>{current.status==='declared'?'Substituir chave':'Declarar chave'}</button>
   </form>}
   {current.status==='declared'&&!revoke&&<button type="button" className={btn} disabled={busy} onClick={()=>{clear();setRevoke(true);}}>Revogar chave</button>}
   {revoke&&<div className="space-y-2">
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo a revogação da chave cadastrada.</label>
    <button type="button" className={btn} disabled={busy||!confirmed} onClick={()=>void submit('revoke')}>Confirmar revogação</button>
    <button type="button" className={btn} disabled={busy} onClick={clear}>Cancelar</button>
   </div>}
  </>}
  <div className="border-t border-slate-700 pt-3"><strong className="text-white">Mercado Pago</strong><p>Vinculação pessoal ainda indisponível.</p></div>
 </section>;
}
