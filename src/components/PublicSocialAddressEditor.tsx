import { useEffect, useState } from 'react';
import { auth } from '../utils/firebase';
import { PresentationShare } from './PresentationShare';
import { buildPublicDestinationUrl, buildPublicDestinationPath } from '../../shared/publicDestinationRoutes';

type Props = { kind:'profile'|'community'; ownerId:string; communityId?:string; suggested?:string; onReserved?:()=>void;showQrByDefault?:boolean };
type Status = {identifier:string|null;eligible:boolean};
const button = 'min-h-11 rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold text-slate-200 disabled:opacity-50';
function errorMessage(code:unknown) {
  return code === 'PUBLIC_ADDRESS_CONFLICT' ? 'Identificador indisponível ou já reservado para este destino.'
    : code === 'PUBLIC_ADDRESS_FORBIDDEN' ? 'Este destino não está disponível para divulgação.'
    : code === 'INVALID_PUBLIC_ADDRESS' ? 'Informe um identificador válido.'
    : 'Não foi possível confirmar o endereço. Tente novamente.';
}
export function PublicSocialAddressEditor({kind,ownerId,communityId,suggested='',onReserved,showQrByDefault=false}:Props) {
  const [input,setInput] = useState(suggested);
  const [status,setStatus] = useState<Status|null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const endpoint = '/api/health?transport=manage-public-social-address&kind='+kind+
    (communityId ? '&communityId='+encodeURIComponent(communityId) : '');
  useEffect(()=>{
    let active = true;
    const controller = new AbortController();
    setStatus(null); setMessage(''); setInput(suggested);
    const load = async () => {
      try {
        const user = auth.currentUser;
        if (!user || user.uid !== ownerId) throw Error('AUTH_REQUIRED');
        const token = await user.getIdToken();
        const res = await fetch(endpoint,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal});
        if (!res.ok) throw Error('UNAVAILABLE');
        const data = await res.json() as Status;
        if (active && auth.currentUser?.uid === ownerId) setStatus(data);
      } catch { if(active) setMessage('Não foi possível consultar seu endereço público.'); }
    };
    void load();
    return ()=>{active=false;controller.abort();};
  },[endpoint,ownerId,suggested]);
  const reserve = async () => {
    if(busy || !status?.eligible || status.identifier || input.length<3 || !buildPublicDestinationPath(kind,input)) return;
    setBusy(true);setMessage('');
    try {
      const user = auth.currentUser;
      if(!user || user.uid!==ownerId) throw Error('AUTH_REQUIRED');
      const token=await user.getIdToken();
      const res=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({identifier:input})});
      const data=await res.json();
      if(!res.ok) throw Error(data.error);
      if(auth.currentUser?.uid===ownerId) {setStatus({identifier:data.identifier,eligible:true});setMessage('Endereço público reservado.');onReserved?.();}
    } catch(error) {setMessage(errorMessage(error instanceof Error?error.message:null));}
    finally {setBusy(false);}
  };
  const url = status?.identifier ? buildPublicDestinationUrl(kind,status.identifier) : null;
  return <section className="space-y-2 rounded-xl border border-slate-700 bg-slate-950 p-3">
    <h4 className="text-sm font-bold text-white">Endereço público</h4>
    {url ? <>
      <a href={url.replace('https://kyrub.com','')} className="block break-all text-sm text-orange-300 underline">{url}</a>
      {!status?.eligible && <p className="text-xs text-slate-400">Endereço reservado, mas não está público.</p>}
      {status?.eligible&&<PresentationShare showQrByDefault={showQrByDefault} url={window.location.origin+(buildPublicDestinationPath(kind,status.identifier!)??'')} title={kind==='profile'?'Minha apresentação Kyrub':'Minha comunidade Kyrub'}/>} 
    </> : <>
      <p className="text-xs text-slate-400">{kind==='profile'?'Escolha um identificador próprio, sem usar seu e-mail.':'Escolha um identificador exclusivo da comunidade.'} O endereço permanece mesmo quando o nome de exibição muda.</p>
      <label className="block text-xs text-slate-300">Identificador
        <input className="mt-1 min-h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-base text-white" maxLength={120} value={input} disabled={!status?.eligible||busy} onChange={e=>setInput(e.target.value.toLowerCase())} placeholder={kind==='profile'?'meu-nome':'minha-comunidade'} />
      </label>
      <p className="break-all text-xs text-slate-400">{buildPublicDestinationUrl(kind,input)||'Use letras minúsculas, números e hífens.'}</p>
      <button type="button" className={button} disabled={!status?.eligible||busy||input.length<3||!buildPublicDestinationPath(kind,input)} onClick={()=>void reserve()}>{busy?'Reservando…':'Confirmar endereço permanente'}</button>
      {status && !status.eligible && <p className="text-xs text-slate-400">Para publicar, o destino precisa estar visível.</p>}
    </>}
    <p role="status" className="text-xs text-slate-300">{message}</p>
  </section>;
}
