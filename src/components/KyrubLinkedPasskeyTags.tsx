import {useEffect,useState} from 'react';
import {auth} from '../utils/firebase';
import {isTagId,isTagModel,KYRUB_TAG_MODEL_LABELS,type KyrubTagModel} from '../../shared/kyrubTagContract';
type LinkedTag={id:string;model:KyrubTagModel;enabled:boolean;blocked:boolean;presentation:{name:string;occupation:string;about:string}};
export function KyrubLinkedPasskeyTags({userId}:{userId:string}){
 const [tags,setTags]=useState<LinkedTag[]>([]);
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  const ctrl=new AbortController();setTags([]);setNotice('');
  // No additional request on the production application.
  if(!window.location.hostname.endsWith('.vercel.app'))return()=>ctrl.abort();
  const user=auth.currentUser;
  if(!user||user.uid!==userId||!user.emailVerified)return()=>ctrl.abort();
  void user.getIdToken(true).then(token=>fetch('/api/health?transport=manage-kyrub-tag&view=linked-passkeys',{cache:'no-store',signal:ctrl.signal,headers:{Authorization:'Bearer '+token}})).then(async res=>{
   if(!res.ok)return;
   const data=await res.json();
   if(ctrl.signal.aborted||auth.currentUser?.uid!==userId||!Array.isArray(data.tags))return;
   setTags(data.tags.filter((tag:LinkedTag)=>isTagId(tag.id)&&isTagModel(tag.model)&&tag.presentation&&typeof tag.presentation.name==='string'));
  }).catch(()=>{});
  return()=>ctrl.abort();
 },[userId]);
 if(!tags.length)return null;
 return <section className="space-y-3 rounded-xl border border-[#34443B] p-3">
  <h5 className="font-bold text-white">Minhas tags com chave de acesso</h5>
  {tags.map(tag=><div key={tag.id} className="space-y-2 rounded-lg border border-[#34443B] p-3 text-sm">
   <strong>{KYRUB_TAG_MODEL_LABELS[tag.model]} · {tag.id.slice(-8)}</strong>
   <p>{tag.presentation.name} · {tag.blocked?'Bloqueada':tag.enabled?'Pública':'Não publicada'}</p>
   <a href={'/tag/'+tag.id} className="block underline text-orange-300">Gerenciar com chave de acesso</a>
   <details><summary className="cursor-pointer">Aproveitar informações do meu cartão</summary><p className="mt-2 whitespace-pre-wrap break-words">{[tag.presentation.name,tag.presentation.occupation,tag.presentation.about].filter(Boolean).join('\n')}</p>
    <p className="mt-1 text-xs text-slate-300">Copie os dados que desejar usar no seu perfil. Nenhuma informação do perfil será alterada automaticamente.</p>
    <button type="button" className="mt-2 underline" onClick={()=>void navigator.clipboard.writeText([tag.presentation.name,tag.presentation.occupation,tag.presentation.about].filter(Boolean).join('\n')).then(()=>setNotice('Informações copiadas.')).catch(()=>setNotice('Selecione e copie o texto manualmente.'))}>Copiar informações</button>
   </details>
  </div>)}
  {notice&&<p role="status" className="text-sm">{notice}</p>}
 </section>;
}
