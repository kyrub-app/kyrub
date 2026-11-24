import {TagSpacesSelector} from './TagSpacesSelector';
import {PresentationShare} from './PresentationShare';
import {useEffect,useState} from 'react';
import {auth} from '../utils/firebase';
import {buildPublicDestinationUrl,parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';
type Card={id:string;enabled:boolean;urls:string[]};
const endpoint='/api/health?transport=manage-public-visit-card';
const button='min-h-11 rounded-xl border border-slate-700 px-3 text-sm font-bold text-slate-200 disabled:opacity-50';
type Space={kind:'store'|'community';name:string;url:string};
export function MultifunctionCardEditor({userId,locked,onSelect,presentationMode=false}:{userId:string;locked:boolean;onSelect?:(card:{name:string;url:string}|null)=>void;presentationMode?:boolean}){
  const [card,setCard]=useState<Card|null>(null);
  const [urls,setUrls]=useState<string[]>([]);
  const [kind,setKind]=useState<'profile'|'store'|'community'>('profile');
  const [identifier,setIdentifier]=useState('');
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [offerSpaces,setOfferSpaces]=useState(false);
  const [spaces,setSpaces]=useState<Space[]>([]);
  const [spacesState,setSpacesState]=useState<'loading'|'ready'|'error'>('loading');
  const [reloadSpaces,setReloadSpaces]=useState(0);
  useEffect(()=>{
    if(!presentationMode)return;
    const ctrl=new AbortController();
    setSpaces([]);setSpacesState('loading');
    const user=auth.currentUser;
    if(!user||user.uid!==userId){setSpacesState('error');return;}
    void user.getIdToken().then(token=>fetch(endpoint+'&view=owned-spaces',{signal:ctrl.signal,cache:'no-store',headers:{Authorization:'Bearer '+token}})).then(async res=>{
      if(!res.ok)throw Error('SPACES_UNAVAILABLE');
      const result=await res.json() as {spaces:Space[]};
      if(!ctrl.signal.aborted&&auth.currentUser?.uid===userId){setSpaces(result.spaces);setSpacesState('ready');}
    }).catch(()=>{if(!ctrl.signal.aborted)setSpacesState('error');});
    return ()=>ctrl.abort();
  },[userId,presentationMode,reloadSpaces]);
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
    setUrls([...urls,url]);setIdentifier('');setMessage('');onSelect?.(null);
  };
  const save=async()=>{
    if(locked||busy||!ready||!urls.length)return;
    setBusy(true);onSelect?.(null);
    try{const result=await request('POST',{urls});if(!result?.enabled)throw Error('CARD_UNAVAILABLE');setCard(result);setUrls(result.urls);setMessage('Cartão publicado. Selecione-o para gravar ou compartilhar.');setOfferSpaces(true);}
    catch(e){setMessage(e instanceof Error&&e.message==='CARD_TARGET_UNAVAILABLE'?'Um destino não está público ou não pertence ao seu perfil. Confira os endereços.':'Não foi possível salvar o cartão.');}
    finally{setBusy(false);}
  };
  const disable=async()=>{
    if(locked||busy)return;
    setBusy(true);onSelect?.(null);
    try{await request('DELETE');setCard(c=>c?{...c,enabled:false}:null);setMessage('Cartão desativado.');}
    catch{setMessage('Não foi possível desativar o cartão.');}finally{setBusy(false);}
  };
  const currentUrl=card?.enabled?buildPublicDestinationUrl('card',card.id):null;
  const dirty=JSON.stringify(urls)!==JSON.stringify(card?.urls??[]);
  return <div className="space-y-3 rounded-xl border border-slate-700 p-3">
    <h6 className="font-bold text-white">{presentationMode?'Meus espaços no Kyrub':'Meu cartão multifuncional'}</h6>
    <p className="text-xs text-slate-400">{presentationMode?'Escolha as lojas e comunidades públicas que deseja apresentar. A publicação atualiza seu cartão digital; adesivos oficiais só recebem os espaços que você selecionar depois.':'Escolha seu perfil público, lojas e comunidades. Links comerciais e coletivos são indicações públicas, não prova de propriedade. Salve para atualizar todas as tags que apontam para seu cartão.'}</p>
    {presentationMode?<div className="space-y-3">
      {spacesState==='loading'&&<p role="status" className="text-sm">Consultando seus espaços…</p>}
      {spacesState==='error'&&<p role="alert" className="text-sm">Não foi possível consultar os espaços. <button type="button" className="underline" onClick={()=>setReloadSpaces(v=>v+1)}>Tentar novamente</button></p>}
      {spacesState==='ready'&&(['community','store'] as const).map(k=><section key={k} className="space-y-2">
        <h6 className="text-sm font-semibold">{k==='community'?'Minhas comunidades':'Minhas lojas'}</h6>
        {spaces.filter(space=>space.kind===k).length===0?<p className="text-xs text-slate-400">Nenhum espaço público com endereço disponível.</p>:spaces.filter(space=>space.kind===k).map(space=><label key={space.url} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 p-2 text-sm">
          <input type="checkbox" checked={urls.includes(space.url)} disabled={locked||busy||!ready||(!urls.includes(space.url)&&urls.length>=8)} onChange={event=>{setUrls(current=>event.target.checked?[...current,space.url]:current.filter(url=>url!==space.url));setMessage('');}}/>
          <span>{space.name}</span>
        </label>)}
      </section>)}
      <p className="text-xs text-slate-400">Destinos privados não são listados. É necessário publicar a loja ou comunidade e definir seu endereço público primeiro.</p>
      <button type="button" className={button} disabled={busy} onClick={()=>setReloadSpaces(v=>v+1)}>Atualizar espaços</button>
    </div>:<>
    <label className="block text-sm">Tipo de destino
      <select disabled={locked||busy||!ready} value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 p-2">
        <option value="profile">Meu perfil</option><option value="store">Loja pública</option><option value="community">Comunidade pública</option>
      </select>
    </label>
    <label className="block text-sm">Identificador
      <input value={identifier} onChange={e=>setIdentifier(e.target.value)} maxLength={120} disabled={locked||busy||!ready} placeholder={kind==='profile'?'maufco':kind==='store'?'@minha-loja':'minha-comunidade'} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 p-2"/>
    </label>
    <button type="button" className={button} disabled={locked||busy||!ready||!identifier.trim()||urls.length>=8} onClick={add}>Adicionar destino</button>
    </>}
    {urls.map(url=><div key={url} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all text-xs">{parsePublicDestinationUrl(url)?.identifier}</span><button type="button" className={button} disabled={locked||busy} onClick={()=>{setUrls(urls.filter(x=>x!==url));onSelect?.(null);}}>Remover</button></div>)}
    <button type="button" className={button} disabled={locked||busy||!ready||!urls.length} onClick={()=>void save()}>{presentationMode?'Salvar e publicar espaços':'Salvar e publicar cartão'}</button>
    {currentUrl&&<div className="space-y-2">
      <a href={'/cartao/'+card?.id} className="block break-all text-sm text-orange-300 underline">{currentUrl}</a>
      {!dirty&&<PresentationShare url={window.location.origin+'/cartao/'+card?.id} title="Meu cartão Kyrub"/>}
      {!presentationMode&&<button type="button" className={button} disabled={locked||busy||dirty} onClick={()=>onSelect?.({name:'Meu cartão multifuncional',url:currentUrl})}>Usar cartão para compartilhar ou gravar</button>}
      <button type="button" className={button} disabled={locked||busy} onClick={()=>void disable()}>Desativar cartão</button>
    </div>}
    {currentUrl&&!dirty&&card?.urls.some(url=>['store','community'].includes(parsePublicDestinationUrl(url)?.kind??''))&&
      <TagSpacesSelector key={userId+card.id+JSON.stringify(card.urls)} userId={userId} urls={card.urls} open={offerSpaces} onOpen={setOfferSpaces} disabled={locked||busy}/>}
    <p role="status" className="text-xs text-slate-300">{message}</p>
  </div>;
}
