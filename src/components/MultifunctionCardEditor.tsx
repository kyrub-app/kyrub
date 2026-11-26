import {useEffect,useState} from 'react';
import {auth} from '../utils/firebase';
import {EMPTY_VISIT_CARD_PRESENTATION,normalizeVisitCardPresentation,hasVisitCardPresentation,type VisitCardPresentation} from '../../shared/visitCardPresentation';
import {loadCardDraft,cardDraftUrls,clearCardDraft,type CardDraft} from '../utils/cardDemonstrationDraft';
import {buildPublicDestinationUrl,parsePublicDestinationUrl} from '../../shared/publicDestinationRoutes';
type Card={id:string;enabled:boolean;urls:string[];presentation?:VisitCardPresentation};
const endpoint='/api/health?transport=manage-public-visit-card';
const button='min-h-11 rounded-xl border border-slate-700 px-3 text-sm font-bold text-slate-200 disabled:opacity-50';
export function MultifunctionCardEditor({userId,locked,onSelect}:{userId:string;locked:boolean;onSelect:(card:{name:string;url:string}|null)=>void}){
  const [card,setCard]=useState<Card|null>(null);
  const [urls,setUrls]=useState<string[]>([]);
  const [presentation,setPresentation]=useState<VisitCardPresentation>({...EMPTY_VISIT_CARD_PRESENTATION});
  const [visitorDraft,setVisitorDraft]=useState<CardDraft|null>(()=>{try{return loadCardDraft(sessionStorage);}catch{return null;}});
  const [imported,setImported]=useState(false);
  const [consent,setConsent]=useState(false);
  const [kind,setKind]=useState<'profile'|'store'|'community'>('profile');
  const [identifier,setIdentifier]=useState('');
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  async function request(method:string,body?:unknown,signal?:AbortSignal){
    const user=auth.currentUser;
    if(!user||user.uid!==userId)throw Error('AUTH_REQUIRED');
    const token=await user.getIdToken();
    const res=await fetch(endpoint,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});
    const data=await res.json();
    if(auth.currentUser?.uid!==userId)throw Error('AUTH_REQUIRED');
    if(!res.ok)throw Error(data.error);
    return data.card as Card|null;
  }
  useEffect(()=>{
    const ctrl=new AbortController();
    setReady(false);
    void request('GET',undefined,ctrl.signal).then(value=>{if(!ctrl.signal.aborted){setCard(value);setUrls(value?.urls??[]);setPresentation(value?.presentation??{...EMPTY_VISIT_CARD_PRESENTATION});setReady(true);}}).catch(()=>{if(!ctrl.signal.aborted)setMessage('Não foi possível consultar o cartão.');});
    return ()=>ctrl.abort();
  },[userId]);
  const add=()=>{
    const url=buildPublicDestinationUrl(kind,identifier.trim().replace(/^@/,'').toLowerCase());
    if(!url||urls.includes(url)||urls.length>=8){setMessage('Informe um destino válido e ainda não incluído (até 8).');return;}
    setUrls([...urls,url]);setConsent(false);setIdentifier('');setMessage('');onSelect(null);
  };
  const save=async()=>{
    if(locked||busy||!ready||!consent||(!urls.length&&!hasVisitCardPresentation(presentation)))return;
    setBusy(true);onSelect(null);
    try{const result=await request('POST',{urls,presentation:normalizeVisitCardPresentation(presentation)});if(!result?.enabled)throw Error('CARD_UNAVAILABLE');setCard(result);setUrls(result.urls);setPresentation(result.presentation??{...EMPTY_VISIT_CARD_PRESENTATION});setConsent(false);if(imported){try{clearCardDraft(sessionStorage);}catch{}setVisitorDraft(null);setImported(false);}setMessage('Cartão publicado. Selecione-o para gravar ou compartilhar.');}
    catch(e){const code=e instanceof Error?e.message:'';setMessage(code==='CARD_TARGET_UNAVAILABLE'?'Um destino não está público ou não pertence ao seu perfil. Confira os endereços.':code==='CARD_PREVIEW_READ_ONLY'?'Prévia de homologação: a publicação real está desativada. Seu rascunho permanece neste navegador.':code==='CARD_VERIFIED_ACCOUNT_REQUIRED'?'Confirme seu e-mail antes de publicar.':'Não foi possível salvar o cartão.');}
    finally{setBusy(false);}
  };
  const disable=async()=>{
    if(locked||busy)return;
    setBusy(true);onSelect(null);
    try{await request('DELETE');setCard(c=>c?{...c,enabled:false}:null);setMessage('Cartão desativado.');}
    catch{setMessage('Não foi possível desativar o cartão.');}finally{setBusy(false);}
  };
  const currentUrl=card?.enabled?buildPublicDestinationUrl('card',card.id):null;
  const dirty=JSON.stringify(urls)!==JSON.stringify(card?.urls??[])||JSON.stringify(presentation)!==JSON.stringify(card?.presentation??EMPTY_VISIT_CARD_PRESENTATION);
  function importDraft(){if(!visitorDraft||locked||busy||!ready)return;setPresentation({name:visitorDraft.name,occupation:visitorDraft.occupation,about:visitorDraft.about});setUrls(cardDraftUrls(visitorDraft));setImported(true);setConsent(false);onSelect(null);setMessage('Rascunho carregado para revisão. Nada foi publicado.');}
  return <div className="space-y-3 rounded-xl border border-slate-700 p-3">
    <h6 className="font-bold text-white">Meu cartão de identificação digital</h6>
    {visitorDraft&&!imported&&<div className="space-y-2 rounded-lg border border-orange-500/40 p-3"><p className="text-sm">Há um rascunho privado neste navegador. Confira se é seu antes de usá-lo; ele substituirá os campos da edição, sem publicar.</p><button type="button" className={button} disabled={locked||busy||!ready} onClick={importDraft}>Aproveitar meu rascunho</button></div>}
    {([{key:'name',label:'Nome',max:80},{key:'occupation',label:'Título ou atividade',max:90},{key:'about',label:'Informações adicionais',max:320}] as const).map(field=><label key={field.key} className="block text-sm">{field.label}<textarea rows={field.key==='about'?3:1} value={presentation[field.key]} maxLength={field.max} disabled={locked||busy||!ready} onChange={e=>{setPresentation(p=>({...p,[field.key]:e.target.value}));setConsent(false);onSelect(null);}} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-2"/></label>)}
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
    {urls.map(url=><div key={url} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all text-xs">{parsePublicDestinationUrl(url)?.identifier}</span><button type="button" className={button} disabled={locked||busy} onClick={()=>{setUrls(urls.filter(x=>x!==url));setConsent(false);onSelect(null);}}>Remover</button></div>)}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={locked||busy||!ready} onChange={e=>setConsent(e.target.checked)}/> Confirmo que estas informações podem ser acessadas publicamente pelo endereço do cartão. Não inclua dados sensíveis ou de terceiros sem autorização.</label>
    <button type="button" className={button} disabled={locked||busy||!ready||!consent||(!urls.length&&!hasVisitCardPresentation(presentation))} onClick={()=>void save()}>Salvar e publicar cartão</button>
    {currentUrl&&<div className="space-y-2">
      <a href={'/cartao/'+card?.id} className="block break-all text-sm text-orange-300 underline">{currentUrl}</a>
      <button type="button" className={button} disabled={locked||busy||dirty} onClick={()=>onSelect({name:presentation.name||'Meu cartão de identificação digital',url:currentUrl})}>Usar cartão para compartilhar ou gravar</button>
      <button type="button" className={button} disabled={locked||busy} onClick={()=>void disable()}>Desativar cartão</button>
    </div>}
    <p role="status" className="text-xs text-slate-300">{message}</p>
  </div>;
}
