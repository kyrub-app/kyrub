import {TagSpacesSelector} from './TagSpacesSelector';
import {useEffect,useState} from 'react';
import {auth} from '../utils/firebase';
import {buildPublicDestinationUrl,parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';
type Card={id:string;enabled:boolean;urls:string[]};
const endpoint='/api/health?transport=manage-public-visit-card';
const button='min-h-11 rounded-xl border border-slate-700 px-3 text-sm font-bold text-slate-200 disabled:opacity-50';
export function MultifunctionCardEditor({userId,locked,onSelect}:{userId:string;locked:boolean;onSelect:(card:{name:string;url:string}|null)=>void}){
  const [card,setCard]=useState<Card|null>(null);
  const [urls,setUrls]=useState<string[]>([]);
  const [kind,setKind]=useState<'profile'|'store'|'community'>('profile');
  const [identifier,setIdentifier]=useState('');
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [offerSpaces,setOfferSpaces]=useState(false);
  async function request(method:string,body?:unknown,signal?:AbortSignal){
    const user=auth.currentUser;
    if(!user||user.uid!==userId)throw Error('AUTH_REQUIRED');
    const token=await user.getIdToken();
    const res=await fetch(endpoint,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});
    const data=await res.json();
    if(!res.ok)throw Error(data.error);
    return data.card as Card|null;
  }
  useEffect(()=>{
    const ctrl=new AbortController();
    setReady(false);
    void request('GET',undefined,ctrl.signal).then(value=>{if(!ctrl.signal.aborted){setCard(value);setUrls(value?.urls??[]);setReady(true);}}).catch(()=>{if(!ctrl.signal.aborted)setMessage('Não foi possível consultar o cartão.');});
    return ()=>ctrl.abort();
  },[userId]);
  const add=()=>{
    const url=buildPublicDestinationUrl(kind,identifier.trim().replace(/^@/,'').toLowerCase());
    if(!url||urls.includes(url)||urls.length>=8){setMessage('Informe um destino válido e ainda não incluído (até 8).');return;}
    setUrls([...urls,url]);setIdentifier('');setMessage('');onSelect(null);
  };
  const save=async()=>{
    if(locked||busy||!ready||!urls.length)return;
    setBusy(true);onSelect(null);
    try{const result=await request('POST',{urls});if(!result?.enabled)throw Error('CARD_UNAVAILABLE');setCard(result);setUrls(result.urls);setMessage('Cartão publicado. Selecione-o para gravar ou compartilhar.');setOfferSpaces(true);}
    catch(e){setMessage(e instanceof Error&&e.message==='CARD_TARGET_UNAVAILABLE'?'Um destino não está público ou não pertence ao seu perfil. Confira os endereços.':'Não foi possível salvar o cartão.');}
    finally{setBusy(false);}
  };
  const disable=async()=>{
    if(locked||busy)return;
    setBusy(true);onSelect(null);
    try{await request('DELETE');setCard(c=>c?{...c,enabled:false}:null);setMessage('Cartão desativado.');}
    catch{setMessage('Não foi possível desativar o cartão.');}finally{setBusy(false);}
  };
  const currentUrl=card?.enabled?buildPublicDestinationUrl('card',card.id):null;
  const dirty=JSON.stringify(urls)!==JSON.stringify(card?.urls??[]);
  return <div className="space-y-3 rounded-xl border border-slate-700 p-3">
    <h6 className="font-bold text-white">Meu cartão multifuncional</h6>
    <p className="text-xs text-slate-400">Escolha seu perfil público, lojas e comunidades. Links comerciais e coletivos são indicações públicas, não prova de propriedade. Salve para atualizar todas as tags que apontam para seu cartão.</p>
    <label className="block text-sm">Tipo de destino
      <select disabled={locked||busy||!ready} value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 p-2">
        <option value="profile">Meu perfil</option><option value="store">Loja pública</option><option value="community">Comunidade pública</option>
      </select>
    </label>
    <label className="block text-sm">Identificador
      <input value={identifier} onChange={e=>setIdentifier(e.target.value)} maxLength={120} disabled={locked||busy||!ready} placeholder={kind==='profile'?'maufco':kind==='store'?'@minha-loja':'minha-comunidade'} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 p-2"/>
    </label>
    <button type="button" className={button} disabled={locked||busy||!ready||!identifier.trim()||urls.length>=8} onClick={add}>Adicionar destino</button>
    {urls.map(url=><div key={url} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all text-xs">{parsePublicDestinationUrl(url)?.identifier}</span><button type="button" className={button} disabled={locked||busy} onClick={()=>{setUrls(urls.filter(x=>x!==url));onSelect(null);}}>Remover</button></div>)}
    <button type="button" className={button} disabled={locked||busy||!ready||!urls.length} onClick={()=>void save()}>Salvar e publicar cartão</button>
    {currentUrl&&<div className="space-y-2">
      <a href={'/cartao/'+card?.id} className="block break-all text-sm text-orange-300 underline">{currentUrl}</a>
      <button type="button" className={button} disabled={locked||busy||dirty} onClick={()=>onSelect({name:'Meu cartão multifuncional',url:currentUrl})}>Usar cartão para compartilhar ou gravar</button>
      <button type="button" className={button} disabled={locked||busy} onClick={()=>void disable()}>Desativar cartão</button>
    </div>}
    {currentUrl&&!dirty&&card?.urls.some(url=>['store','community'].includes(parsePublicDestinationUrl(url)?.kind??''))&&
      <TagSpacesSelector key={userId+card.id+JSON.stringify(card.urls)} userId={userId} urls={card.urls} open={offerSpaces} onOpen={setOfferSpaces} disabled={locked||busy}/>}
    <p role="status" className="text-xs text-slate-300">{message}</p>
  </div>;
}
