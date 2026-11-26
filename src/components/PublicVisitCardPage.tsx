import {useEffect,useState} from 'react';
import {parsePublicDestinationUrl,buildPublicDestinationPath} from '../../shared/publicDestinationRoutes';
type Link={kind:'profile'|'community'|'store';identifier:string;name:string;url:string};
export function PublicVisitCardPage({identifier}:{identifier:string}){
  const [links,setLinks]=useState<Link[]|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const ctrl=new AbortController();
    setLinks(null);setError('');
    void fetch('/api/health?transport=public-visit-card&id='+encodeURIComponent(identifier),{cache:'no-store',signal:ctrl.signal}).then(async res=>{
      if(!res.ok)throw Error(res.status===404?'Este cartão não está disponível.':'Não foi possível carregar o cartão.');
      const data=await res.json();
      if(data.id!==identifier||!Array.isArray(data.links))throw Error('Cartão indisponível.');
      if(!ctrl.signal.aborted)setLinks(data.links.filter((l:Link)=>{const p=typeof l?.url==='string'?parsePublicDestinationUrl(l.url):null;return p&&p.kind!=='card'&&p.kind===l.kind&&p.identifier===l.identifier&&typeof l.name==='string';}));
    }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Cartão indisponível.');});
    return ()=>ctrl.abort();
  },[identifier]);
  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100"><div className="mx-auto max-w-md space-y-4 py-8">
    <a href="/" className="flex items-center gap-2 font-black text-orange-300"><img src="/kyrub-logo.svg" alt="" className="h-10 w-10"/>Kyrub</a>
    <h1 className="text-2xl font-black">Cartão de visita digital</h1>
    {error?<p role="status">{error}</p>:links===null?<p role="status">Carregando cartão…</p>:links.length===0?<p>Não há destinos públicos disponíveis.</p>:links.map(l=><a key={l.url} href={buildPublicDestinationPath(l.kind,l.identifier)??'/'} className="block rounded-2xl border border-slate-700 bg-slate-900 p-4"><span className="block text-xs uppercase text-orange-300">{l.kind==='profile'?'Perfil':l.kind==='store'?'Loja':'Comunidade'}</span><strong className="break-words">{l.name}</strong></a>)}
    <a href="/" className="block rounded-xl bg-orange-500 p-3 text-center font-bold text-slate-950">Explorar Kyrub</a>
  </div></main>;
}
